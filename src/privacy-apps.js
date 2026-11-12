(function (root) {
  const applications = [
    { id: 'zoom', name: 'Zoom', processes: ['zoom.us', 'Zoom'] },
    { id: 'teams', name: 'Microsoft Teams', processes: ['Microsoft Teams', 'MSTeams', 'ms-teams', 'Teams'] },
    { id: 'webex', name: 'Webex', processes: ['Webex', 'Cisco Webex Meetings'] },
    { id: 'slack', name: 'Slack', processes: ['Slack'] },
    { id: 'discord', name: 'Discord', processes: ['Discord'] },
    { id: 'obs', name: 'OBS', processes: ['OBS', 'obs64'] },
    { id: 'quicktime', name: 'QuickTime Player', processes: ['QuickTime Player'] },
    { id: 'screen-sharing', name: 'Screen Sharing', processes: ['Screen Sharing', 'screencaptureui'] },
    { id: 'chrome', name: 'Google Chrome', processes: ['Google Chrome', 'chrome'] },
    { id: 'edge', name: 'Microsoft Edge', processes: ['Microsoft Edge', 'msedge'] },
    { id: 'firefox', name: 'Firefox', processes: ['firefox'] },
    { id: 'safari', name: 'Safari', processes: ['Safari'] },
    { id: 'brave', name: 'Brave', processes: ['Brave Browser', 'brave'] },
    { id: 'arc', name: 'Arc', processes: ['Arc'] },
    { id: 'opera', name: 'Opera', processes: ['Opera'] },
  ];
  const selected = value => Array.isArray(value) ? [...new Set(value.filter(id => applications.some(app => app.id === id)))].sort() : [];
  const api = { applications, selected };
  if (typeof module !== 'undefined') module.exports = api; else root.asterPrivacyApps = api;
})(typeof window === 'undefined' ? {} : window);
