const Module = require("module");
Module._extensions[".css"] = function (mod) {
  mod.exports = {};
};
