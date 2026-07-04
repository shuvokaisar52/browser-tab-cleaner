// CleanIt - Popup JS Controller

// Mock Chrome Extension APIs if running in standard web browser (for standalone testing)
if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
  window.chrome = {
    runtime: {
      sendMessage: async (msg) => {
        console.log("Mocked sendMessage:", msg);
        return { success: true };
      }
    },
    storage: {
      local: {
        get: async (keys) => {
          console.log("Mocked storage.local.get:", keys);
          return {
            autoCloseEnabled: true,
            inactivityLimitMinutes: 30,
            whitelist: ["github.com", "notion.so"],
            ignorePinned: true,
            ignoreAudio: true,
            totalClosedCount: 14,
            closedTabsHistory: [
              {
                id: "1",
                title: "Reddit - Frontpage",
                url: "https://reddit.com",
                favIconUrl: "https://www.google.com/s2/favicons?domain=reddit.com",
                closedAt: Date.now() - 120000
              },
              {
                id: "2",
                title: "HTML - Wikipedia",
                url: "https://wikipedia.org",
                favIconUrl: "https://www.google.com/s2/favicons?domain=wikipedia.org",
                closedAt: Date.now() - 3600000
              }
            ]
          };
        },
        set: async (data) => {
          console.log("Mocked storage.local.set:", data);
          return {};
        }
      },
      onChanged: {
        addListener: (callback) => {
          console.log("Mocked storage.onChanged.addListener");
        }
      }
    },
    tabs: {
      query: async (queryInfo) => {
        console.log("Mocked tabs.query:", queryInfo);
        // Returns activeTabs/allTabs mock depending on query properties
        if (queryInfo.active) {
          return [{ id: 101 }];
        }
        return [
          {
            id: 101,
            title: document.title || "CleanIt - Smart Tab Cleaner",
            url: window.location.href,
            favIconUrl: "https://www.google.com/s2/favicons?domain=localhost",
            pinned: false,
            audible: false
          },
          {
            id: 102,
            title: "CleanIt/Repo - GitHub",
            url: "https://github.com/CleanIt/Repo",
            favIconUrl: "https://www.google.com/s2/favicons?domain=github.com",
            pinned: false,
            audible: false
          },
          {
            id: 103,
            title: "YouTube - LoFi Girl",
            url: "https://youtube.com",
            favIconUrl: "https://www.google.com/s2/favicons?domain=youtube.com",
            pinned: false,
            audible: true
          }
        ];
      },
      remove: async (tabId) => {
        console.log("Mocked tabs.remove:", tabId);
        return {};
      },
      create: async (createProperties) => {
        console.log("Mocked tabs.create:", createProperties);
        return {};
      }
    }
  };
}

document.addEventListener("DOMContentLoaded", async () => {
  // UI Elements
  const toggleAutoClose = document.getElementById("toggleAutoClose");
  const statusPulse = document.getElementById("statusPulse");
  const statusLabel = document.getElementById("statusLabel");
  
  const statsClosed = document.getElementById("statsClosed");
  const statsActive = document.getElementById("statsActive");
  const statsRam = document.getElementById("statsRam");
  
  const limitSlider = document.getElementById("limitSlider");
  const durationDisplay = document.getElementById("durationDisplay");
  const sliderTooltip = document.getElementById("sliderTooltip");
  
  
  const ignorePinned = document.getElementById("ignorePinned");
  const ignoreAudio = document.getElementById("ignoreAudio");
  
  
  // Navigation elements
  const tabButtons = document.querySelectorAll(".tab-btn");
  const tabViews = document.querySelectorAll(".tab-view");
  
  // History elements
  const historyList = document.getElementById("historyList");
  const btnClearHistory = document.getElementById("btnClearHistory");

  // Tab switching logic
  tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const targetView = btn.getAttribute("data-tab");
      
      tabButtons.forEach(b => b.classList.remove("active"));
      tabViews.forEach(v => v.classList.remove("active"));
      
      btn.classList.add("active");
      document.getElementById(targetView).classList.add("active");
      
      if (targetView === "tab-history") {
        renderHistoryList();
      } else {
        renderTabsList();
      }
    });
  });

  // Load Settings and Stats
  const settings = await chrome.storage.local.get([
    "autoCloseEnabled",
    "inactivityLimitMinutes",
    "whitelist",
    "ignorePinned",
    "ignoreAudio",
    "totalClosedCount",
    "closedTabsHistory"
  ]);

  // Sync state to UI
  toggleAutoClose.checked = settings.autoCloseEnabled !== false;
  updateStatusUI(toggleAutoClose.checked);
  
  limitSlider.value = settings.inactivityLimitMinutes || 30;
  updateSliderDisplay(limitSlider.value);
  
  ignorePinned.checked = settings.ignorePinned !== false;
  ignoreAudio.checked = settings.ignoreAudio !== false;
  
  updateStats(settings.totalClosedCount || 0);
  

  
  // Initial check & rendering
  chrome.runtime.sendMessage({ action: "checkNow" })
    .catch(err => console.warn("Background worker not ready yet:", err))
    .finally(() => {
      renderTabsList();
      renderHistoryList();
    });
  
  // Update tabs and run check active tab worker periodically (every 5 seconds) to close instantly
  const tabUpdateInterval = setInterval(() => {
    chrome.runtime.sendMessage({ action: "checkNow" })
      .catch(err => console.warn("Background check failed:", err))
      .finally(() => {
        const activeTabBtn = document.querySelector(".tab-btn.active");
        if (activeTabBtn && activeTabBtn.getAttribute("data-tab") === "tab-monitor") {
          renderTabsList();
        } else {
          renderHistoryList();
        }
      });
  }, 5000);
  
  // Handlers
  
  // Toggle main auto close
  toggleAutoClose.addEventListener("change", async () => {
    const isEnabled = toggleAutoClose.checked;
    updateStatusUI(isEnabled);
    await chrome.storage.local.set({ autoCloseEnabled: isEnabled });
    
    // Force a background check if turned back on
    if (isEnabled) {
      // Small trigger to force check
      chrome.runtime.sendMessage({ action: "checkNow" }).catch(() => {});
    }
  });
  
  // Time slider input (realtime display)
  limitSlider.addEventListener("input", () => {
    updateSliderDisplay(limitSlider.value);
  });
  
  // Time slider change (commit to storage)
  limitSlider.addEventListener("change", async () => {
    const minutes = parseInt(limitSlider.value);
    await chrome.storage.local.set({ inactivityLimitMinutes: minutes });
    renderTabsList();
  });

  // Keep tooltip visible during active dragging
  limitSlider.addEventListener("mousedown", () => {
    sliderTooltip.classList.add("visible");
  });
  limitSlider.addEventListener("touchstart", () => {
    sliderTooltip.classList.add("visible");
  });
  
  document.addEventListener("mouseup", () => {
    sliderTooltip.classList.remove("visible");
  });
  document.addEventListener("touchend", () => {
    sliderTooltip.classList.remove("visible");
  });
  
  
  // Settings checkbox toggles
  ignorePinned.addEventListener("change", async () => {
    await chrome.storage.local.set({ ignorePinned: ignorePinned.checked });
    renderTabsList();
  });
  
  ignoreAudio.addEventListener("change", async () => {
    await chrome.storage.local.set({ ignoreAudio: ignoreAudio.checked });
    renderTabsList();
  });
  


  // Listen for background tab closures to dynamically update the closed count
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local") {
      if (changes.totalClosedCount) {
        updateStats(changes.totalClosedCount.newValue);
      }
      if (changes.tabLastActiveTimes || changes.closedTabsHistory) {
        const activeTabBtn = document.querySelector(".tab-btn.active");
        if (activeTabBtn && activeTabBtn.getAttribute("data-tab") === "tab-monitor") {
          renderTabsList();
        } else {
          renderHistoryList();
        }
      }
    }
  });

  // Clear History
  btnClearHistory.addEventListener("click", async () => {
    if (confirm("Are you sure you want to clear your cleaned tabs history?")) {
      await chrome.storage.local.set({ closedTabsHistory: [] });
      renderHistoryList();
    }
  });

  // Helper: Update active/paused state header display
  function updateStatusUI(isEnabled) {
    if (isEnabled) {
      statusPulse.className = "status-pulse active";
      statusLabel.textContent = "Active";
      statusLabel.style.color = "var(--color-success)";
    } else {
      statusPulse.className = "status-pulse";
      statusLabel.textContent = "Paused";
      statusLabel.style.color = "var(--text-muted)";
    }
  }

  // Helper: Update inactivity range display and tooltip
  function updateSliderDisplay(val) {
    const minutes = parseInt(val);
    durationDisplay.textContent = `${minutes} Min`;
    sliderTooltip.textContent = `${minutes}m`;

    // Update track progress gradient
    const min = parseInt(limitSlider.min) || 15;
    const max = parseInt(limitSlider.max) || 180;
    const percent = (minutes - min) / (max - min);
    limitSlider.style.setProperty('--value-percent', `${percent * 100}%`);

    // Update floating tooltip position dynamically to track the thumb
    const thumbWidth = 20; // matches CSS
    const offset = (percent - 0.5) * thumbWidth;
    sliderTooltip.style.left = `calc(${percent * 100}% - ${offset}px)`;
  }

  // Helper: Update stats cards UI
  function updateStats(closedCount) {
    statsClosed.textContent = closedCount;
    
    // Estimate RAM saved (approx 50MB per closed tab)
    const ramMB = closedCount * 50;
    if (ramMB < 1024) {
      statsRam.textContent = `${ramMB} MB`;
    } else {
      const ramGB = (ramMB / 1024).toFixed(1);
      statsRam.textContent = `${ramGB} GB`;
    }
  }



  // Toggle whitelist membership via tab action click
  async function toggleWhitelistDomain(host) {
    const settings = await chrome.storage.local.get("whitelist");
    let list = settings.whitelist || [];
    if (list.includes(host)) {
      list = list.filter(item => item !== host);
    } else {
      list.push(host);
    }
    await chrome.storage.local.set({ whitelist: list });
    renderTabsList();
  }

  // Render the monitor list of open tabs
  async function renderTabsList() {
    try {
      const settings = await chrome.storage.local.get([
        "inactivityLimitMinutes",
        "tabLastActiveTimes",
        "whitelist",
        "ignorePinned",
        "ignoreAudio"
      ]);
      
      const limitMinutes = settings.inactivityLimitMinutes || 30;
      const limitMs = limitMinutes * 60 * 1000;
      const activeTimes = settings.tabLastActiveTimes || {};
      const whitelist = settings.whitelist || [];
      const ignorePinned = settings.ignorePinned !== false;
      const ignoreAudio = settings.ignoreAudio !== false;
      
      const tabs = await chrome.tabs.query({});
      const activeTabs = await chrome.tabs.query({ active: true });
      const activeTabIds = new Set(activeTabs.map(t => t.id));
      
      const tabsList = document.getElementById("tabsList");
      const tabCountElement = document.getElementById("tabCount");
      
      tabCountElement.textContent = `${tabs.length} Open`;
      if (statsActive) statsActive.textContent = tabs.length;
      
      if (tabs.length === 0) {
        tabsList.innerHTML = `<div class="empty-state">No tabs open.</div>`;
        return;
      }
      
      const now = Date.now();
      
      // Map and analyze status
      const mappedTabs = tabs.map(tab => {
        const isTabActive = activeTabIds.has(tab.id);
        const isPinned = ignorePinned && tab.pinned;
        const isAudio = ignoreAudio && tab.audible;
        const host = getHostname(tab.url);
        const isWhitelistedTab = isWhitelisted(tab.url, whitelist);
        const isInternal = tab.url && (
          tab.url.startsWith("chrome://") || 
          tab.url.startsWith("chrome-extension://") || 
          tab.url.startsWith("edge://") || 
          tab.url.startsWith("about:")
        );
        
        const isLocked = isPinned || isAudio || isWhitelistedTab || isInternal;
        
        const lastActive = activeTimes[tab.id] || now;
        const elapsed = now - lastActive;
        const remaining = limitMs - elapsed;
        
        return {
          tab,
          isTabActive,
          isPinned,
          isAudio,
          isWhitelistedTab,
          isInternal,
          isLocked,
          remaining,
          host
        };
      });
      
      // Sort: Active first, then non-locked by shortest time, then locked tabs
      mappedTabs.sort((a, b) => {
        if (a.isTabActive) return -1;
        if (b.isTabActive) return 1;
        
        if (a.isLocked && !b.isLocked) return 1;
        if (!a.isLocked && b.isLocked) return -1;
        
        if (!a.isLocked && !b.isLocked) {
          return a.remaining - b.remaining;
        }
        
        return a.tab.title.localeCompare(b.tab.title);
      });
      
      tabsList.innerHTML = "";
      
      mappedTabs.forEach(({ tab, isTabActive, isPinned, isAudio, isWhitelistedTab, isInternal, isLocked, remaining, host }) => {
        const item = document.createElement("div");
        item.className = "tab-item";
        
        if (!isTabActive && !isLocked && remaining < Math.min(2 * 60 * 1000, limitMs * 0.2)) {
          item.classList.add("closing-soon");
        }
        
        // Favicon setup
        let favImg = "";
        if (tab.favIconUrl && !tab.favIconUrl.startsWith("chrome://") && !tab.favIconUrl.startsWith("chrome-extension://")) {
          favImg = `<img class="tab-fav" src="${escapeHtml(tab.favIconUrl)}">`;
        }
        
        const initial = tab.title ? tab.title.charAt(0).toUpperCase() : "T";
        const placeholder = `<div class="tab-fav-placeholder" style="display: ${favImg ? 'none' : 'flex'}">${initial}</div>`;
        
        // Assemble badges/status
        let statusHtml = "";
        if (isTabActive) {
          statusHtml = `<span class="badge active-badge">Active Now</span>`;
        } else if (isPinned) {
          statusHtml = `<span class="badge locked-badge">Pinned</span>`;
        } else if (isAudio) {
          statusHtml = `<span class="badge locked-badge">Playing Audio</span>`;
        } else if (isWhitelistedTab) {
          statusHtml = `<span class="badge locked-badge">Whitelisted</span>`;
        } else if (isInternal) {
          statusHtml = `<span class="badge locked-badge">System Page</span>`;
        } else {
          if (remaining <= 0) {
            statusHtml = `<span class="tab-countdown">Closing soon</span>`;
          } else {
            statusHtml = `<span class="tab-countdown">${formatTimeRemaining(remaining)}</span>`;
          }
        }
        
        const lockTitle = isWhitelistedTab ? "Remove domain from whitelist" : "Add domain to whitelist";
        const lockIconClass = isWhitelistedTab ? "locked" : "";
        
        const lockSvg = isWhitelistedTab ? 
          `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
          </svg>` : 
          `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
            <path d="M7 11V7a5 5 0 0 1 9.9-1"></path>
          </svg>`;
          
        item.innerHTML = `
          <div class="tab-info-row">
            ${favImg}
            ${placeholder}
            <div class="tab-details">
              <span class="tab-title" title="${escapeHtml(tab.title || '')}">${escapeHtml(tab.title || 'Untitled Tab')}</span>
              <div class="tab-meta">
                ${statusHtml}
              </div>
            </div>
          </div>
          <div class="tab-actions">
            ${(!isInternal && host) ? `
              <button class="btn-icon lock-btn ${lockIconClass}" data-host="${escapeHtml(host)}" title="${lockTitle}">
                ${lockSvg}
              </button>
            ` : ''}
            <button class="btn-icon close-btn" data-tab-id="${tab.id}" title="Close tab immediately">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        `;
        
        // Event listeners
        const lockBtn = item.querySelector(".lock-btn");
        if (lockBtn) {
          lockBtn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const targetHost = lockBtn.getAttribute("data-host");
            await toggleWhitelistDomain(targetHost);
          });
        }
        
        const closeBtn = item.querySelector(".close-btn");
        closeBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const targetTabId = parseInt(closeBtn.getAttribute("data-tab-id"));
          try {
            await chrome.tabs.remove(targetTabId);
            renderTabsList();
          } catch(err) {
            console.error(err);
          }
        });
        
        const img = item.querySelector(".tab-fav");
        if (img) {
          img.addEventListener("error", () => {
            img.style.display = "none";
            const placeholder = item.querySelector(".tab-fav-placeholder");
            if (placeholder) placeholder.style.display = "flex";
          });
        }
        
        tabsList.appendChild(item);
      });
    } catch (e) {
      console.error("Error rendering tabs list: ", e);
    }
  }

  // Helper: parse url hostname
  function getHostname(urlStr) {
    if (!urlStr) return "";
    try {
      const url = new URL(urlStr);
      return url.hostname.toLowerCase();
    } catch(e) {
      return "";
    }
  }

  // Helper: check whitelist matching
  function isWhitelisted(urlStr, whitelist) {
    if (!urlStr) return false;
    try {
      const url = new URL(urlStr);
      const hostname = url.hostname.toLowerCase();
      
      for (let item of whitelist) {
        const cleanItem = item.trim().toLowerCase();
        if (!cleanItem) continue;
        
        if (hostname === cleanItem || hostname.endsWith("." + cleanItem)) {
          return true;
        }
      }
    } catch (e) {
      for (let item of whitelist) {
        if (urlStr.toLowerCase().includes(item.toLowerCase())) {
          return true;
        }
      }
    }
    return false;
  }

  // Helper: Format milliseconds into human string
  function formatTimeRemaining(ms) {
    const totalSecs = Math.max(0, Math.floor(ms / 1000));
    if (totalSecs < 60) {
      return `${totalSecs}s left`;
    }
    const mins = Math.floor(totalSecs / 60);
    if (mins < 60) {
      const secs = totalSecs % 60;
      return `${mins}m ${secs}s left`;
    }
    const hrs = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return `${hrs}h ${remainingMins}m left`;
  }

  // Helper: Escapes html characters
  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
  // Render the list of closed tabs in the history tab
  async function renderHistoryList() {
    try {
      const settings = await chrome.storage.local.get("closedTabsHistory");
      const history = settings.closedTabsHistory || [];
      
      if (history.length === 0) {
        historyList.innerHTML = `<div class="empty-state">No tabs have been auto-closed yet.</div>`;
        return;
      }
      
      historyList.innerHTML = "";
      
      history.forEach(item => {
        const historyItem = document.createElement("div");
        historyItem.className = "history-item";
        
        // Favicon setup
        let favImg = "";
        if (item.favIconUrl && !item.favIconUrl.startsWith("chrome://") && !item.favIconUrl.startsWith("chrome-extension://")) {
          favImg = `<img class="tab-fav" src="${escapeHtml(item.favIconUrl)}">`;
        }
        
        const initial = item.title ? item.title.charAt(0).toUpperCase() : "T";
        const placeholder = `<div class="tab-fav-placeholder" style="display: ${favImg ? 'none' : 'flex'}">${initial}</div>`;
        
        const closedTimeStr = formatRelativeTime(item.closedAt);
        
        historyItem.innerHTML = `
          <div class="history-info-row">
            ${favImg}
            ${placeholder}
            <div class="history-details">
              <span class="history-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</span>
              <div class="history-meta">
                <span>${closedTimeStr}</span>
                <span>•</span>
                <span class="history-url" title="${escapeHtml(item.url)}" style="max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(getHostname(item.url))}</span>
              </div>
            </div>
          </div>
          <div class="history-actions">
            <button class="btn-icon restore-btn" data-id="${item.id}" data-url="${escapeHtml(item.url)}" title="Restore Tab">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path>
              </svg>
            </button>
            <button class="btn-icon delete-history-btn" data-id="${item.id}" title="Remove from History">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        `;
        
        // Event Listeners for actions
        const restoreBtn = historyItem.querySelector(".restore-btn");
        restoreBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const targetUrl = restoreBtn.getAttribute("data-url");
          const targetId = restoreBtn.getAttribute("data-id");
          try {
            await chrome.tabs.create({ url: targetUrl });
            await removeHistoryEntry(targetId);
          } catch(err) {
            console.error(err);
          }
        });
        
        const deleteBtn = historyItem.querySelector(".delete-history-btn");
        deleteBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const targetId = deleteBtn.getAttribute("data-id");
          await removeHistoryEntry(targetId);
        });
        
        const img = historyItem.querySelector(".tab-fav");
        if (img) {
          img.addEventListener("error", () => {
            img.style.display = "none";
            const placeholder = historyItem.querySelector(".tab-fav-placeholder");
            if (placeholder) placeholder.style.display = "flex";
          });
        }
        
        historyList.appendChild(historyItem);
      });
    } catch (e) {
      console.error("Error rendering history list: ", e);
    }
  }

  // Helper to remove an entry from history
  async function removeHistoryEntry(id) {
    const settings = await chrome.storage.local.get("closedTabsHistory");
    let history = settings.closedTabsHistory || [];
    history = history.filter(item => item.id !== id);
    await chrome.storage.local.set({ closedTabsHistory: history });
    renderHistoryList();
  }

  // Helper: Format relative timestamp
  function formatRelativeTime(timestamp) {
    const diffMs = Date.now() - timestamp;
    const diffSecs = Math.floor(diffMs / 1000);
    if (diffSecs < 60) return "Just now";
    
    const diffMins = Math.floor(diffSecs / 60);
    if (diffMins < 60) return `${diffMins}m ago`;
    
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
});
