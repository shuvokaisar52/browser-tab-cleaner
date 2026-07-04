// CleanIt - Background Service Worker

// Initialize settings and tracking on install
chrome.runtime.onInstalled.addListener(async () => {
  console.log("CleanIt extension installed.");
  
  // Set up periodic alarm (every 1 minute)
  chrome.alarms.create("checkInactiveTabs", { periodInMinutes: 1 });
  
  // Initialize default settings if not already present
  const settings = await chrome.storage.local.get([
    "autoCloseEnabled",
    "inactivityLimitMinutes",
    "whitelist",
    "ignorePinned",
    "ignoreAudio",
    "totalClosedCount"
  ]);
  
  const defaults = {};
  if (settings.autoCloseEnabled === undefined) defaults.autoCloseEnabled = true;
  if (settings.inactivityLimitMinutes === undefined) defaults.inactivityLimitMinutes = 30;
  if (settings.whitelist === undefined) {
    defaults.whitelist = ["gmail.com", "calendar.google.com", "slack.com", "github.com"];
  }
  if (settings.ignorePinned === undefined) defaults.ignorePinned = true;
  if (settings.ignoreAudio === undefined) defaults.ignoreAudio = true;
  if (settings.totalClosedCount === undefined) defaults.totalClosedCount = 0;
  
  if (Object.keys(defaults).length > 0) {
    await chrome.storage.local.set(defaults);
  }
  
  await initializeTabTracking();
});

// Initialize tracking when startup occurs
chrome.runtime.onStartup.addListener(async () => {
  await initializeTabTracking();
});

// Helper to initialize tab tracking times
async function initializeTabTracking() {
  const result = await chrome.storage.local.get("tabLastActiveTimes");
  let activeTimes = result.tabLastActiveTimes || {};
  const tabs = await chrome.tabs.query({});
  const now = Date.now();
  
  let updated = false;
  
  // Track open tabs
  tabs.forEach(tab => {
    if (!activeTimes[tab.id]) {
      activeTimes[tab.id] = now;
      updated = true;
    }
  });
  
  // Clean up stale tabs
  const openTabIds = new Set(tabs.map(t => t.id));
  for (let tabId in activeTimes) {
    if (!openTabIds.has(parseInt(tabId))) {
      delete activeTimes[tabId];
      updated = true;
    }
  }
  
  if (updated) {
    await chrome.storage.local.set({ tabLastActiveTimes: activeTimes });
  }
}

// Track tab activations
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const now = Date.now();
  const result = await chrome.storage.local.get("tabLastActiveTimes");
  let activeTimes = result.tabLastActiveTimes || {};
  
  // Update current active tab
  activeTimes[activeInfo.tabId] = now;
  
  // Also update active tabs in other windows if they are currently highlighted
  const activeTabs = await chrome.tabs.query({ active: true });
  activeTabs.forEach(tab => {
    activeTimes[tab.id] = now;
  });
  
  await chrome.storage.local.set({ tabLastActiveTimes: activeTimes });
});

// Clean up stored times when tabs are closed manually
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const result = await chrome.storage.local.get("tabLastActiveTimes");
  let activeTimes = result.tabLastActiveTimes || {};
  if (activeTimes[tabId]) {
    delete activeTimes[tabId];
    await chrome.storage.local.set({ tabLastActiveTimes: activeTimes });
  }
});

// Track updates (navigation, reloads)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    const now = Date.now();
    const result = await chrome.storage.local.get("tabLastActiveTimes");
    let activeTimes = result.tabLastActiveTimes || {};
    activeTimes[tabId] = now;
    await chrome.storage.local.set({ tabLastActiveTimes: activeTimes });
  }
});

// Run cleaning check when alarm triggers
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "checkInactiveTabs") {
    await checkTabs();
  }
});

// The core auto-close tab analysis
async function checkTabs() {
  const settings = await chrome.storage.local.get([
    "autoCloseEnabled",
    "inactivityLimitMinutes",
    "whitelist",
    "ignorePinned",
    "ignoreAudio",
    "totalClosedCount",
    "tabLastActiveTimes"
  ]);
  
  if (!settings.autoCloseEnabled) {
    return;
  }
  
  const limitMinutes = settings.inactivityLimitMinutes || 30;
  const limitMs = limitMinutes * 60 * 1000;
  const whitelist = settings.whitelist || [];
  const ignorePinned = settings.ignorePinned !== false;
  const ignoreAudio = settings.ignoreAudio !== false;
  let totalClosedCount = settings.totalClosedCount || 0;
  let activeTimes = settings.tabLastActiveTimes || {};
  
  const tabs = await chrome.tabs.query({});
  const now = Date.now();
  let updatedActiveTimes = { ...activeTimes };
  let tabsToClose = [];
  let closedIncrement = 0;
  
  // Find active tabs in all windows
  const activeTabs = await chrome.tabs.query({ active: true });
  const activeTabIds = new Set(activeTabs.map(t => t.id));
  
  tabs.forEach(tab => {
    const tabId = tab.id;
    
    // Ignore internal pages
    if (tab.url && (
      tab.url.startsWith("chrome://") || 
      tab.url.startsWith("chrome-extension://") || 
      tab.url.startsWith("edge://") || 
      tab.url.startsWith("about:")
    )) {
      updatedActiveTimes[tabId] = now;
      return;
    }
    
    // Active tabs never close
    if (activeTabIds.has(tabId)) {
      updatedActiveTimes[tabId] = now;
      return;
    }
    
    // Ignore pinned tabs if setting enabled
    if (ignorePinned && tab.pinned) {
      updatedActiveTimes[tabId] = now;
      return;
    }
    
    // Ignore audio-playing tabs if setting enabled
    if (ignoreAudio && tab.audible) {
      updatedActiveTimes[tabId] = now;
      return;
    }
    
    // Ignore whitelisted domains
    if (isWhitelisted(tab.url, whitelist)) {
      updatedActiveTimes[tabId] = now;
      return;
    }
    
    // If tab is not tracked, initialize it
    if (!updatedActiveTimes[tabId]) {
      updatedActiveTimes[tabId] = now;
      return;
    }
    
    // Check if inactive for longer than limit
    const inactiveDuration = now - updatedActiveTimes[tabId];
    if (inactiveDuration > limitMs) {
      tabsToClose.push({
        id: tabId,
        title: tab.title || "Untitled Tab",
        url: tab.url || "",
        favIconUrl: tab.favIconUrl || ""
      });
      delete updatedActiveTimes[tabId];
      closedIncrement++;
    }
  });
  
  // Clean up references to closed/stale tabs
  const openTabIds = new Set(tabs.map(t => t.id));
  for (let id in updatedActiveTimes) {
    if (!openTabIds.has(parseInt(id))) {
      delete updatedActiveTimes[id];
    }
  }
  
  // Close the selected tabs
  if (tabsToClose.length > 0) {
    const historyResult = await chrome.storage.local.get("closedTabsHistory");
    let history = historyResult.closedTabsHistory || [];
    
    for (let tabInfo of tabsToClose) {
      try {
        await chrome.tabs.remove(tabInfo.id);
        
        // Log to history
        history.unshift({
          id: Date.now() + "_" + Math.random().toString(36).substr(2, 5),
          title: tabInfo.title,
          url: tabInfo.url,
          favIconUrl: tabInfo.favIconUrl,
          closedAt: Date.now()
        });
      } catch (e) {
        console.error(`Error closing tab ${tabInfo.id}:`, e);
      }
    }
    
    // Limit history length to 30 items
    if (history.length > 30) {
      history = history.slice(0, 30);
    }
    
    totalClosedCount += closedIncrement;
    await chrome.storage.local.set({ totalClosedCount, closedTabsHistory: history });
  }
  
  await chrome.storage.local.set({ tabLastActiveTimes: updatedActiveTimes });
}

// Check if a URL matches the whitelist
function isWhitelisted(urlStr, whitelist) {
  if (!urlStr) return false;
  try {
    const url = new URL(urlStr);
    const hostname = url.hostname.toLowerCase();
    
    for (let item of whitelist) {
      const cleanItem = item.trim().toLowerCase();
      if (!cleanItem) continue;
      
      // Match domain or subdomains
      if (hostname === cleanItem || hostname.endsWith("." + cleanItem)) {
        return true;
      }
    }
  } catch (e) {
    // Fallback simple search
    for (let item of whitelist) {
      if (urlStr.toLowerCase().includes(item.toLowerCase())) {
        return true;
      }
    }
  }
  return false;
}

// Listen for manual check requests from popup (provides instant closing)
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "checkNow") {
      checkTabs().then(() => {
        sendResponse({ success: true });
      });
      return true; // Keep message channel open for async response
    }
  });

// Run live interval checks every 5 seconds (while service worker is awake)
setInterval(checkTabs, 5000);

// Immediate check on startup to ensure we don't start with stale state
initializeTabTracking();
