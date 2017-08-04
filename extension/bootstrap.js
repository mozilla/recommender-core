/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const { classes: Cc, interfaces: Ci, utils: Cu } = Components;
Cu.import("resource://gre/modules/AppConstants.jsm");
Cu.import("resource://gre/modules/Console.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "IndexedDB", "resource://gre/modules/IndexedDB.jsm");

const SHAREBUTTON_CSS_URI = Services.io.newURI("resource://recommender-core/share_button.css");
const PANEL_CSS_URI = Services.io.newURI("resource://recommender-core/panel.css");
const browserWindowWeakMap = new WeakMap();


const minutes = 1000 * 60;
const hours = minutes * 60;
const days = hours * 24;

const config = {
  recommendations: [
    {
      name: "Amazon Extension",
      event: {
        type: "pageview-session",
        domains: [
          "amazon.com",
          "audible.com",
          "zappos.com",
        ],
        count: 3,
        period: 7 * days,
        visitLength: 15 * minutes,
      },
      recommendation: {
        type: "addon-install-panel",
        xpiUrl: "https://addons.mozilla.org/en-US/firefox/addon/amazon-browser-bar/", // todo, use direct url for XPI
      },
    },
    {
      name: "Wikipedia",
      event: {
        type: "pageview-session",
        domains: [
          "wikipedia.org",
          "wiktionary.org",
        ],
        count: 4,
        period: 2 * days,
        session: 15 * minutes,
      },
      recommendation: {
        type: "addon-install-panel",
        xpiUrl: "TODO",
      },
    },
  ],
};

this.install = function(data, reason) {};

this.startup = function(data, reason) {
  // iterate over all open windows
  const windowEnumerator = Services.wm.getEnumerator("navigator:browser");
  while (windowEnumerator.hasMoreElements()) {
    const window = windowEnumerator.getNext();
    if (window.gBrowser) {
      browserWindowWeakMap.set(window, new BrowserWindow(window));
    }
  }

  // add an event listener for new windows
  Services.wm.addListener(windowListener);
};

this.shutdown = function(data, reason) {
  // remove event listener for new windows before processing WeakMap
  // to avoid race conditions (ie. new window added during shutdown)
  Services.wm.removeListener(windowListener);

  const windowEnumerator = Services.wm.getEnumerator("navigator:browser");
  while (windowEnumerator.hasMoreElements()) {
    const window = windowEnumerator.getNext();
    if (browserWindowWeakMap.has(window)) {
      const browserWindow = browserWindowWeakMap.get(window);
      browserWindow.shutdown();
    }
  }
};

this.uninstall = function(data, reason) {};

function doorhangerTreatment(browserWindow, shareButton) {
  let panel = browserWindow.window.document.getElementById("share-button-panel");

  if (panel === null) {
    panel = browserWindow.window.document.createElement("panel");
    panel.setAttribute("id", "share-button-panel");
    panel.setAttribute("type", "arrow");
    panel.setAttribute("noautofocus", true);
    panel.setAttribute("level", "parent");

    const embeddedBrowser = browserWindow.window.document.createElement("browser");
    embeddedBrowser.setAttribute("id", "share-button-doorhanger");
    embeddedBrowser.setAttribute("src", "resource://recommender-core/doorhanger.html");
    embeddedBrowser.setAttribute("type", "content");
    embeddedBrowser.setAttribute("disableglobalhistory", "true");
    embeddedBrowser.setAttribute("flex", "1");

    panel.appendChild(embeddedBrowser);
    browserWindow.window.document.getElementById("mainPopupSet").appendChild(panel);
  }

  panel.openPopup(shareButton, "bottomcenter topright", 0, 0, false, false);
}

// Implements nsIWebProgressListener
class BrowserWindow {
  constructor(window) {
    this.window = window;
    //this.insertCSS();

    if (this.window.gBrowser) {
      this.window.gBrowser.addTabsProgressListener(this);
    }
  }

  shutdown() {
    //this.removeCSS();

    // Remove the share-button-panel
    //const sharePanel = this.window.document.getElementById("share-button-panel");
    //if (sharePanel !== null) {
    //  sharePanel.remove();
    //}
  }

  insertCSS() {
    const utils = this.window.QueryInterface(Ci.nsIInterfaceRequestor)
      .getInterface(Ci.nsIDOMWindowUtils);
    utils.loadSheet(SHAREBUTTON_CSS_URI, utils.AGENT_SHEET);
    utils.loadSheet(PANEL_CSS_URI, utils.AGENT_SHEET);
  }

  removeCSS() {
    const utils = this.window.QueryInterface(Ci.nsIInterfaceRequestor)
      .getInterface(Ci.nsIDOMWindowUtils);
    utils.removeSheet(SHAREBUTTON_CSS_URI, utils.AGENT_SHEET);
    utils.removeSheet(PANEL_CSS_URI, utils.AGENT_SHEET);
  }

  onLocationChange(target, progress, request, location, flags) {
    console.log('BrowserWindow.onLocationChange(', { target, progress, request, location, flags }, ')');
  }

  onProgressChange() {}
  onSecurityChange() {}
  onStateChange() {}
  onStatusChange() {}
  onRefreshAttempted() {}
  onLinkIconAvailable() {}
}

// Implements nsIWindowMediatorlistener
const windowListener = {
  onWindowTitleChange(window, title) {},

  onOpenWindow(xulWindow) {
    // xulWindow is of type nsIXULWindow, cast to an nsIDOMWindow
    const domWindow = xulWindow.QueryInterface(Ci.nsIInterfaceRequestor)
      .getInterface(Ci.nsIDOMWindow);

    // Wait for the window to actually open before storing a reference to it.
    const onWindowOpen = () => {
      domWindow.removeEventListener("load", onWindowOpen);
      if (domWindow.gBrowser) {
        browserWindowWeakMap.set(domWindow, new BrowserWindow(domWindow));
      }
    };

    domWindow.addEventListener("load", onWindowOpen, true);
  },

  onCloseWindow(window) {
    if (browserWindowWeakMap.has(window)) {
      const browserWindow = browserWindowWeakMap.get(window);
      browserWindowWeakMap.delete(window);
      browserWindow.shutdown();
    }
  },
};


"use strict";

const DB_NAME = "recommender-core";
const DB_OPTIONS = {
  version: 1,
  storage: "persistent",
};

/**
 * Cache the database connection so that it is shared among multiple operations.
 */
let databasePromise;
async function getDatabase() {
  if (!databasePromise) {
    databasePromise = IndexedDB.open(DB_NAME, DB_OPTIONS, (db) => {
      db.createObjectStore(DB_NAME, {
        keyPath: "name",
      });
    });
  }
  return databasePromise;
}

/**
 * Get a transaction for interacting with the study store.
 *
 * NOTE: Methods on the store returned by this function MUST be called
 * synchronously, otherwise the transaction with the store will expire.
 * This is why the helper takes a database as an argument; if we fetched the
 * database in the helper directly, the helper would be async and the
 * transaction would expire before methods on the store were called.
 */
function getStore(db) {
  return db.objectStore(DB_NAME, "readwrite");
}

const EventStorage = {
  async clear() {
    const db = await getDatabase();
    await getStore(db).clear();
  },

  async close() {
    if (databasePromise) {
      const promise = databasePromise;
      databasePromise = null;
      const db = await promise;
      await db.close();
    }
  },

  async has(studyName) {
    const db = await getDatabase();
    const study = await getStore(db).get(studyName);
    return !!study;
  },

  async get(studyName) {
    const db = await getDatabase();
    const study = await getStore(db).get(studyName);
    if (!study) {
      throw new Error(`Could not find a study named ${studyName}.`);
    }

    return study;
  },

  async logEvent(type, data) {
    const db = await getDatabase();
    return getStore(db).
  }

  async create(study) {
    if (!validateCreate(study)) {
      throw new Error(
        `Cannot create study: validation failed: ${ajvInstance.errorsText(validateCreate.errors)}`,
      );
    }

    const db = await getDatabase();
    if (await getStore(db).get(study.name)) {
      throw new Error(
        `Cannot create study with name ${study.name}: a study exists with that name already.`,
      );
    }

    return getStore(db).add(study);
  },

  async update(studyName, data) {
    const db = await getDatabase();
    const savedStudy = await getStore(db).get(studyName);
    if (!savedStudy) {
      throw new Error(`Cannot update study ${studyName}: could not find study.`);
    }

    if (!validateUpdate(data)) {
      throw new Error(`
        Cannot update study ${studyName}: validation failed:
        ${ajvInstance.errorsText(validateUpdate.errors)}
      `);
    }

    return getStore(db).put(Object.assign({}, savedStudy, data));
  },
};
