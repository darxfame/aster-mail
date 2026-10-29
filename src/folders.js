(function (root) {
  function tree(folders, defaults) {
    const known = new Map(folders.filter(f => f.wellKnown).map(f => [f.wellKnown, f]));
    const ids = new Map(folders.map(f => [f.id, f.wellKnown || f.id]));
    const nodes = new Map();
    for (const [alias, name, symbol] of defaults) {
      const folder = known.get(alias);
      nodes.set(alias, { ...folder, key: alias, name, symbol, children: [], parent: null });
    }
    for (const folder of folders) {
      if (folder.wellKnown || nodes.has(folder.id)) continue;
      nodes.set(folder.id, { ...folder, key: folder.id, symbol: 'folder', children: [], parent: ids.get(folder.parentId) || folder.parentId });
    }
    const roots = [];
    for (const node of nodes.values()) {
      // Broken/cyclic server hierarchies remain visible as roots.
      let parent = node.parent, cycle = false;
      const visited = new Set([node.key]);
      while (nodes.has(parent)) { if (visited.has(parent)) { cycle = true; break; } visited.add(parent); parent = nodes.get(parent).parent; }
      if (!cycle && nodes.has(node.parent)) nodes.get(node.parent).children.push(node); else roots.push(node);
    }
    const order = key => ({ inbox: 0, sentitems: 1, drafts: 2, archive: 4, deleteditems: 5, junkemail: 6 }[key] ?? 3);
    roots.sort((a, b) => order(a.key) - order(b.key));
    return roots;
  }
  if (typeof module !== 'undefined') module.exports = { tree }; else root.asterFolders = { tree };
})(typeof window === 'undefined' ? {} : window);
