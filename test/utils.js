/* eslint-env node */
// The geckodriver package downloads and installs geckodriver for us.
// We use it by requiring it.
require("geckodriver");
const assert = require("assert");
const cmd = require("selenium-webdriver/lib/command");
const firefox = require("selenium-webdriver/firefox");
const Fs = require("fs-extra");
const FxRunnerUtils = require("fx-runner/lib/utils");
const path = require("path");
const webdriver = require("selenium-webdriver");

const By = webdriver.By;
const Context = firefox.Context;
const until = webdriver.until;

// Note: Geckodriver already has quite a good set of default preferences
// for disabling various items.
// https://github.com/mozilla/geckodriver/blob/master/src/marionette.rs
const FIREFOX_PREFERENCES = {
  // Ensure e10s is turned on.
  "browser.tabs.remote.autostart": true,
  "browser.tabs.remote.autostart.1": true,
  "browser.tabs.remote.autostart.2": true,
  // These are good to have set up if you're debugging tests with the browser
  // toolbox.
  "devtools.chrome.enabled": true,
  "devtools.debugger.remote-enabled": true,
};

// useful if we need to test on a specific version of Firefox
async function promiseActualBinary(binary) {
  try {
    const normalizedBinary = await FxRunnerUtils.normalizeBinary(binary);
    await Fs.stat(normalizedBinary);
    return normalizedBinary;
  } catch (ex) {
    if (ex.code === "ENOENT") {
      throw new Error(`Could not find ${binary}`);
    }
    throw ex;
  }
}

module.exports.promiseSetupDriver = async() => {
  const profile = new firefox.Profile();

  Object.keys(FIREFOX_PREFERENCES).forEach((key) => {
    profile.setPreference(key, FIREFOX_PREFERENCES[key]);
  });

  const options = new firefox.Options();
  options.setProfile(profile);

  const builder = new webdriver.Builder()
    .forBrowser("firefox")
    .setFirefoxOptions(options);

  const binaryLocation = await promiseActualBinary(process.env.FIREFOX_BINARY || "firefox");
  await options.setBinary(new firefox.Binary(binaryLocation));
  const driver = await builder.build();
  driver.setContext(Context.CHROME);
  return driver;
};

module.exports.addShareButton = async driver =>
  driver.executeAsyncScript((callback) => {
    // see https://dxr.mozilla.org/mozilla-central/rev/211d4dd61025c0a40caea7a54c9066e051bdde8c/browser/base/content/browser-social.js#193
    Components.utils.import("resource:///modules/CustomizableUI.jsm");
    CustomizableUI.addWidgetToArea("social-share-button", CustomizableUI.AREA_NAVBAR);
    callback();
  });

module.exports.installAddon = async(driver) => {
  // references:
  //    https://bugzilla.mozilla.org/show_bug.cgi?id=1298025
  //    https://github.com/mozilla/geckodriver/releases/tag/v0.17.0
  const xpiName = process.env.XPI_NAME || 'recommender-core.xpi';
  const fileLocation = path.join(process.cwd(), xpiName);
  const executor = driver.getExecutor();
  executor.defineCommand("installAddon", "POST", "/session/:sessionId/moz/addon/install");
  const installCmd = new cmd.Command("installAddon");

  const session = await driver.getSession();
  installCmd.setParameters({ sessionId: session.getId(), path: fileLocation, temporary: true });
  return executor.execute(installCmd);
};

module.exports.uninstallAddon = async(driver, id) => {
  const executor = driver.getExecutor();
  executor.defineCommand("uninstallAddon", "POST", "/session/:sessionId/moz/addon/uninstall");
  const uninstallCmd = new cmd.Command("uninstallAddon");

  const session = await driver.getSession();
  uninstallCmd.setParameters({ sessionId: session.getId(), id });
  await executor.execute(uninstallCmd);
};

module.exports.promiseAddonButton = async(driver) => {
  driver.setContext(Context.CHROME);
  try {
    return await driver.wait(until.elementLocated(
      By.id("social-share-button")), 1000);
  } catch (e) {
    // if there an error, the button was not found
    // so return null
    return null;
  }
};

module.exports.promiseUrlBar = (driver) => {
  driver.setContext(Context.CHROME);
  return driver.wait(until.elementLocated(
    By.id("urlbar")), 1000);
};

function getModifierKey() {
  const modifierKey = process.platform === "darwin" ?
    webdriver.Key.COMMAND : webdriver.Key.CONTROL;
  return modifierKey;
}

module.exports.openWindow = async(driver) => {
  // send MODIFIER + N
  driver.setContext(Context.CHROME);
  const urlBar = await module.exports.promiseUrlBar(driver);
  const modifierKey = getModifierKey();
  await urlBar.sendKeys(webdriver.Key.chord(modifierKey, "N"));
  // close the old window
  await driver.close();
  // switch the driver to the new window
  const handles = await driver.getAllWindowHandles();
  assert(handles.length >= 1);
  await driver.switchTo().window(handles[0]);
};

module.exports.copyUrlBar = async(driver) => {
  const urlBar = await module.exports.promiseUrlBar(driver);
  const modifierKey = getModifierKey();
  await urlBar.sendKeys(webdriver.Key.chord(modifierKey, "A"));
  await urlBar.sendKeys(webdriver.Key.chord(modifierKey, "C"));
};

module.exports.testAnimation = async(driver) => {
  const button = await module.exports.promiseAddonButton(driver);
  if (button === null) { return { hasClass: false, hasColor: false }; }

  const buttonClassString = await button.getAttribute("class");
  const buttonColor = await button.getCssValue("background-color");

  const hasClass = buttonClassString.split(" ").includes("social-share-button-on");
  const hasColor = buttonColor.includes("43, 153, 255");
  return { hasClass, hasColor };
};

// FIXME waitForClassAdded is no longer being used?
module.exports.waitForClassAdded = async driver =>
  driver.wait(async() => {
    const { hasClass } = await module.exports.testAnimation(driver);
    return hasClass;
  }, 2000);

module.exports.waitForAnimationEnd = async driver =>
  driver.wait(async() => {
    const { hasClass, hasColor } = await module.exports.testAnimation(driver);
    return !hasClass && !hasColor;
  }, 2000);

module.exports.takeScreenshot = async(driver) => {
  try {
    const data = await driver.takeScreenshot();
    return await Fs.outputFile("./screenshot.png",
      data, "base64");
  } catch (screenshotError) {
    throw screenshotError;
  }
};

module.exports.testPanel = async(driver) => {
  driver.setContext(Context.CHROME);
  try { // if we can't find the panel, return false
    return await driver.wait(async() => {
      // need to execute JS, since state is not an HTML attribute, it's a property
      const panelState = await driver.executeAsyncScript((callback) => {
        const shareButtonPanel = window.document.getElementById("share-button-panel");
        if (shareButtonPanel === null) {
          callback(null);
        } else {
          const state = shareButtonPanel.state;
          callback(state);
        }
      });
      return panelState === "open";
    }, 3000);
  } catch (e) {
    if (e.name === "TimeoutError") { return null; }
    throw e;
  }
};

module.exports.closePanel = async(driver) => {
  const urlbar = await module.exports.promiseUrlBar(driver);
  await urlbar.sendKeys(webdriver.Key.ESCAPE);
};
