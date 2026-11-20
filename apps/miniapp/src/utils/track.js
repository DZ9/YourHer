const noop = () => {};
const id = () => "req_" + Date.now() + "_" + Math.random().toString(36).slice(2, 12);
module.exports = {
  init: noop,
  installPageHook: noop,
  setEnabled: noop,
  track: noop,
  trackImmediate: noop,
  trackError: noop,
  trackPage: noop,
  flushNow: noop,
  onAppLaunch: noop,
  onAppShow: noop,
  onAppHide: noop,
  onAppError: noop,
  pushRecentTraceId: noop,
  newTraceId: id, newClientRequestId: id, getRecentTraceIds: () => [], getAnonId: () => "", getBuildHash: () => "opensource", getNetType: () => "unknown"
};
