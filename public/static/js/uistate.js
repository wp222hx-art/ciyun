// 界面偏好：提示条是否收起、各分组上次停留的页面、新手引导是否看过。
// 单独成模块，入口（app.js）与页面（首页、帮助中心）共用同一份，不会互相覆盖。
import * as store from './core/store.js';

export const ui = store.persisted('zjt.ui.v1', () => ({ v: 1, noticeCollapsed: false, lastInGroup: {}, welcomeOff: false, tourSeen: false }));
