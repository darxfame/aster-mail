// Frozen protocol 1 broker. Release builds copy its signed binary byte for byte.
// No sockets, files, service names, keys or executable paths are accepted from clients.
import Foundation
import Security
import CryptoKit
import Darwin

let magic = Data("ASTK1".utf8)
let maxPlaintext = 1024 * 1024
let maxFrame = 3 * 1024 * 1024
let parentPID = getppid()
#if ASTER_KEYCHAIN_FIXTURE
let protocolTag = "fixture-1"
#else
let protocolTag = "1"
#endif
let requirementText = "identifier \"app.astermail.desktop\" and certificate leaf = H\"94449af39dabd49526a09ae19047190ec2d165e8\" and info[AsterKeychainProtocol] = \"\(protocolTag)\""
let service: String
// Test binaries cannot access the production item; this switch changes their hash.
#if ASTER_KEYCHAIN_FIXTURE
service = "app.astermail.keychain.fixture.v1"
#else
service = "app.astermail.keychain.v1"
#endif
let account = "encryption-key"
enum BrokerError: Error { case denied, invalid, keychain(OSStatus) }
var requirement: SecRequirement?
guard CommandLine.arguments.count == 1, parentPID > 1,
      SecRequirementCreateWithString(requirementText as CFString, [], &requirement) == errSecSuccess else { exit(77) }
var inputStat = stat(), outputStat = stat()
func privateChannel(_ mode: mode_t) -> Bool {
  // libuv implements child stdio with anonymous Unix socket pairs on macOS.
  let kind = mode & S_IFMT
  return kind == S_IFIFO || kind == S_IFSOCK
}
guard fstat(STDIN_FILENO, &inputStat) == 0, fstat(STDOUT_FILENO, &outputStat) == 0,
      privateChannel(inputStat.st_mode), privateChannel(outputStat.st_mode) else { exit(77) }

func matchingFramework(_ caller: SecStaticCode) throws {
  // Nested-code DRs permit older signed frameworks. Bind this caller to the
  // exact hardened Electron build recorded in its secured, signed Info.plist.
  var signedInfo: CFDictionary?
  guard SecCodeCopySigningInformation(caller, SecCSFlags(rawValue: kSecCSSigningInformation), &signedInfo) == errSecSuccess,
        let info = signedInfo as? [String: Any],
        let plist = info[kSecCodeInfoPList as String] as? [String: Any],
        let expected = plist["AsterKeychainFrameworkHash"] as? String,
        let executable = info[kSecCodeInfoMainExecutable as String] as? URL else { throw BrokerError.denied }
  let bundle = executable.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
  let framework = bundle.appendingPathComponent("Contents/Frameworks/Electron Framework.framework/Electron Framework")
  var code: SecStaticCode?
  guard SecStaticCodeCreateWithPath(framework as CFURL, [], &code) == errSecSuccess, let code = code,
        SecStaticCodeCheckValidity(code, SecCSFlags(rawValue: kSecCSStrictValidate), nil) == errSecSuccess else { throw BrokerError.denied }
  var frameworkInfo: CFDictionary?
  guard SecCodeCopySigningInformation(code, SecCSFlags(rawValue: kSecCSSigningInformation), &frameworkInfo) == errSecSuccess,
        let fields = frameworkInfo as? [String: Any], let digest = fields[kSecCodeInfoUnique as String] as? Data,
        digest.map({ String(format: "%02x", $0) }).joined() == expected else { throw BrokerError.denied }
}

func authorizedParent(staticCheck: Bool = false) throws {
  guard getppid() == parentPID else { throw BrokerError.denied }
  var code: SecCode?
  let attributes = [kSecGuestAttributePid as String: NSNumber(value: parentPID)] as CFDictionary
  guard SecCodeCopyGuestWithAttributes(nil, attributes, [], &code) == errSecSuccess,
        let caller = code,
        SecCodeCheckValidity(caller, SecCSFlags(rawValue: kSecCSStrictValidate), requirement) == errSecSuccess else { throw BrokerError.denied }
  if staticCheck {
    var diskCode: SecStaticCode?
    guard SecCodeCopyStaticCode(caller, [], &diskCode) == errSecSuccess, let disk = diskCode,
          SecStaticCodeCheckValidity(disk, SecCSFlags(rawValue: kSecCSStrictValidate), requirement) == errSecSuccess else { throw BrokerError.denied }
    try matchingFramework(disk)
  }
}
do { try authorizedParent(staticCheck: true) } catch { exit(77) }

var cachedKey: SymmetricKey?
func key(create: Bool) throws -> SymmetricKey {
  if let key = cachedKey { return key }
  let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: service, kSecAttrAccount as String: account,
    kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
  var item: CFTypeRef?
  let status = SecItemCopyMatching(query as CFDictionary, &item)
  if status == errSecSuccess, let bytes = item as? Data, bytes.count == 32 {
    let key = SymmetricKey(data: bytes); cachedKey = key; return key
  }
  guard status == errSecItemNotFound && create else { throw BrokerError.keychain(status) }
  var bytes = Data(count: 32)
  guard bytes.withUnsafeMutableBytes({ SecRandomCopyBytes(kSecRandomDefault, 32, $0.baseAddress!) }) == errSecSuccess else { throw BrokerError.invalid }
  let attributes: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: service, kSecAttrAccount as String: account,
    kSecAttrLabel as String: "Aster Mail encryption key (helper v1)", kSecValueData as String: bytes]
  let added = SecItemAdd(attributes as CFDictionary, nil)
  // Another valid Aster instance may have created the same item first.
  if added == errSecDuplicateItem { return try key(create: false) }
  guard added == errSecSuccess else { throw BrokerError.keychain(added) }
  let key = SymmetricKey(data: bytes); cachedKey = key; return key
}

func perform(_ request: [String: Any]) throws -> String {
  guard Set(request.keys).isSubset(of: ["id", "operation", "data"]), let operation = request["operation"] as? String else { throw BrokerError.invalid }
  if operation == "ping" { return "1" }
  #if ASTER_KEYCHAIN_FIXTURE
  if operation == "reset" {
    let status = SecItemDelete([kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service, kSecAttrAccount as String: account] as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else { throw BrokerError.keychain(status) }
    cachedKey = nil; return "1"
  }
  #endif
  guard let encoded = request["data"] as? String, let data = Data(base64Encoded: encoded), data.count <= maxPlaintext + 33 else { throw BrokerError.invalid }
  if operation == "encrypt" {
    guard data.count <= maxPlaintext else { throw BrokerError.invalid }
    let sealed = try AES.GCM.seal(data, using: key(create: true))
    guard let combined = sealed.combined else { throw BrokerError.invalid }
    return (magic + combined).base64EncodedString()
  }
  if operation == "decrypt" {
    guard data.starts(with: magic), data.count >= 33 else { throw BrokerError.invalid }
    let sealed = try AES.GCM.SealedBox(combined: data.dropFirst(magic.count))
    return try AES.GCM.open(sealed, using: key(create: false)).base64EncodedString()
  }
  throw BrokerError.invalid
}

var buffer = Data()
while true {
  let chunk: Data
  do { chunk = try FileHandle.standardInput.read(upToCount: 4096) ?? Data() } catch { exit(74) }
  if chunk.isEmpty { exit(0) }
  buffer.append(chunk)
  while let newline = buffer.firstIndex(of: 10) {
    if newline > maxFrame { exit(65) }
    let frame = Data(buffer[..<newline]); buffer.removeSubrange(...newline)
    do {
      try authorizedParent()
      guard let request = try JSONSerialization.jsonObject(with: frame) as? [String: Any],
            let id = request["id"] as? NSNumber, CFGetTypeID(id) != CFBooleanGetTypeID(),
            id.doubleValue == Double(id.intValue), id.intValue > 0 else { throw BrokerError.invalid }
      var reply: [String: Any] = ["id": id]
      do { reply["result"] = try perform(request); reply["ok"] = true }
      catch { reply["ok"] = false } // Never include input, decrypted values or keys in errors.
      try authorizedParent()
      let output = try JSONSerialization.data(withJSONObject: reply)
      try FileHandle.standardOutput.write(contentsOf: output + Data([10]))
    } catch { exit(77) }
  }
  if buffer.count > maxFrame { exit(65) }
}
