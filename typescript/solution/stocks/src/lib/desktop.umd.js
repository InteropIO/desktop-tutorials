(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
  typeof define === 'function' && define.amd ? define(factory) :
  (global = typeof globalThis !== 'undefined' ? globalThis : global || self, global.desktop = factory());
})(this, (function () { 'use strict';

  var MetricTypes = {
      STRING: 1,
      NUMBER: 2,
      TIMESTAMP: 3,
      OBJECT: 4
  };

  function getMetricTypeByValue(metric) {
      if (metric.type === MetricTypes.TIMESTAMP) {
          return "timestamp";
      }
      else if (metric.type === MetricTypes.NUMBER) {
          return "number";
      }
      else if (metric.type === MetricTypes.STRING) {
          return "string";
      }
      else if (metric.type === MetricTypes.OBJECT) {
          return "object";
      }
      return "unknown";
  }
  function getTypeByValue(value) {
      if (value.constructor === Date) {
          return "timestamp";
      }
      else if (typeof value === "number") {
          return "number";
      }
      else if (typeof value === "string") {
          return "string";
      }
      else if (typeof value === "object") {
          return "object";
      }
      else {
          return "string";
      }
  }
  function serializeMetric(metric) {
      const serializedMetrics = {};
      const type = getMetricTypeByValue(metric);
      if (type === "object") {
          const values = Object.keys(metric.value).reduce((memo, key) => {
              const innerType = getTypeByValue(metric.value[key]);
              if (innerType === "object") {
                  const composite = defineNestedComposite(metric.value[key]);
                  memo[key] = {
                      type: "object",
                      description: "",
                      context: {},
                      composite,
                  };
              }
              else {
                  memo[key] = {
                      type: innerType,
                      description: "",
                      context: {},
                  };
              }
              return memo;
          }, {});
          serializedMetrics.composite = values;
      }
      serializedMetrics.name = normalizeMetricName(metric.path.join("/") + "/" + metric.name);
      serializedMetrics.type = type;
      serializedMetrics.description = metric.description;
      serializedMetrics.context = {};
      return serializedMetrics;
  }
  function defineNestedComposite(values) {
      return Object.keys(values).reduce((memo, key) => {
          const type = getTypeByValue(values[key]);
          if (type === "object") {
              memo[key] = {
                  type: "object",
                  description: "",
                  context: {},
                  composite: defineNestedComposite(values[key]),
              };
          }
          else {
              memo[key] = {
                  type,
                  description: "",
                  context: {},
              };
          }
          return memo;
      }, {});
  }
  function normalizeMetricName(name) {
      if (typeof name !== "undefined" && name.length > 0 && name[0] !== "/") {
          return "/" + name;
      }
      else {
          return name;
      }
  }
  function getMetricValueByType(metric) {
      const type = getMetricTypeByValue(metric);
      if (type === "timestamp") {
          return Date.now();
      }
      else {
          return publishNestedComposite(metric.value);
      }
  }
  function publishNestedComposite(values) {
      if (typeof values !== "object") {
          return values;
      }
      return Object.keys(values).reduce((memo, key) => {
          const value = values[key];
          if (typeof value === "object" && value.constructor !== Date) {
              memo[key] = publishNestedComposite(value);
          }
          else if (value.constructor === Date) {
              memo[key] = new Date(value).getTime();
          }
          else if (value.constructor === Boolean) {
              memo[key] = value.toString();
          }
          else {
              memo[key] = value;
          }
          return memo;
      }, {});
  }
  function flatten(arr) {
      return arr.reduce((flat, toFlatten) => {
          return flat.concat(Array.isArray(toFlatten) ? flatten(toFlatten) : toFlatten);
      }, []);
  }
  function getHighestState(arr) {
      return arr.sort((a, b) => {
          if (!a.state) {
              return 1;
          }
          if (!b.state) {
              return -1;
          }
          return b.state - a.state;
      })[0];
  }
  function aggregateDescription(arr) {
      let msg = "";
      arr.forEach((m, idx, a) => {
          const path = m.path.join(".");
          if (idx === a.length - 1) {
              msg += path + "." + m.name + ": " + m.description;
          }
          else {
              msg += path + "." + m.name + ": " + m.description + ",";
          }
      });
      if (msg.length > 100) {
          return msg.slice(0, 100) + "...";
      }
      else {
          return msg;
      }
  }
  function composeMsgForRootStateMetric(system) {
      const aggregatedState = system.root.getAggregateState();
      const merged = flatten(aggregatedState);
      const highestState = getHighestState(merged);
      const aggregateDesc = aggregateDescription(merged);
      return {
          description: aggregateDesc,
          value: highestState.state,
      };
  }

  function gw3 (connection, config) {
      if (!connection || typeof connection !== "object") {
          throw new Error("Connection is required parameter");
      }
      let joinPromise;
      let session;
      const init = (repo) => {
          let resolveReadyPromise;
          joinPromise = new Promise((resolve) => {
              resolveReadyPromise = resolve;
          });
          session = connection.domain("metrics");
          session.onJoined((reconnect) => {
              if (!reconnect && resolveReadyPromise) {
                  resolveReadyPromise();
                  resolveReadyPromise = undefined;
              }
              const rootStateMetric = {
                  name: "/State",
                  type: "object",
                  composite: {
                      Description: {
                          type: "string",
                          description: "",
                      },
                      Value: {
                          type: "number",
                          description: "",
                      },
                  },
                  description: "System state",
                  context: {},
              };
              const defineRootMetricsMsg = {
                  type: "define",
                  metrics: [rootStateMetric],
              };
              session.send(defineRootMetricsMsg);
              if (reconnect) {
                  replayRepo(repo);
              }
          });
          session.join({
              system: config.system,
              service: config.service,
              instance: config.instance
          });
      };
      const replayRepo = (repo) => {
          replaySystem(repo.root);
      };
      const replaySystem = (system) => {
          createSystem(system);
          system.metrics.forEach((m) => {
              createMetric(m);
          });
          system.subSystems.forEach((ss) => {
              replaySystem(ss);
          });
      };
      const createSystem = async (system) => {
          if (system.parent === undefined) {
              return;
          }
          await joinPromise;
          const metric = {
              name: normalizeMetricName(system.path.join("/") + "/" + system.name + "/State"),
              type: "object",
              composite: {
                  Description: {
                      type: "string",
                      description: "",
                  },
                  Value: {
                      type: "number",
                      description: "",
                  },
              },
              description: "System state",
              context: {},
          };
          const createMetricsMsg = {
              type: "define",
              metrics: [metric],
          };
          session.send(createMetricsMsg);
      };
      const updateSystem = async (system, state) => {
          await joinPromise;
          const shadowedUpdateMetric = {
              type: "publish",
              values: [{
                      name: normalizeMetricName(system.path.join("/") + "/" + system.name + "/State"),
                      value: {
                          Description: state.description,
                          Value: state.state,
                      },
                      timestamp: Date.now(),
                  }],
          };
          session.send(shadowedUpdateMetric);
          const stateObj = composeMsgForRootStateMetric(system);
          const rootMetric = {
              type: "publish",
              peer_id: connection.peerId,
              values: [{
                      name: "/State",
                      value: {
                          Description: stateObj.description,
                          Value: stateObj.value,
                      },
                      timestamp: Date.now(),
                  }],
          };
          session.send(rootMetric);
      };
      const createMetric = async (metric) => {
          const metricClone = cloneMetric(metric);
          await joinPromise;
          const m = serializeMetric(metricClone);
          const createMetricsMsg = {
              type: "define",
              metrics: [m],
          };
          session.send(createMetricsMsg);
          if (typeof metricClone.value !== "undefined") {
              updateMetricCore(metricClone);
          }
      };
      const updateMetric = async (metric) => {
          const metricClone = cloneMetric(metric);
          await joinPromise;
          updateMetricCore(metricClone);
      };
      const updateMetricCore = (metric) => {
          if (canUpdate()) {
              const value = getMetricValueByType(metric);
              const publishMetricsMsg = {
                  type: "publish",
                  values: [{
                          name: normalizeMetricName(metric.path.join("/") + "/" + metric.name),
                          value,
                          timestamp: Date.now(),
                      }],
              };
              return session.sendFireAndForget(publishMetricsMsg);
          }
          return Promise.resolve();
      };
      const cloneMetric = (metric) => {
          const metricClone = { ...metric };
          if (typeof metric.value === "object" && metric.value !== null) {
              metricClone.value = { ...metric.value };
          }
          return metricClone;
      };
      const canUpdate = () => {
          try {
              const func = config.canUpdateMetric ?? (() => true);
              return func();
          }
          catch {
              return true;
          }
      };
      return {
          init,
          createSystem,
          updateSystem,
          createMetric,
          updateMetric,
      };
  }

  var Helpers = {
      validate: (definition, parent, transport) => {
          if (definition === null || typeof definition !== "object") {
              throw new Error("Missing definition");
          }
          if (parent === null || typeof parent !== "object") {
              throw new Error("Missing parent");
          }
          if (transport === null || typeof transport !== "object") {
              throw new Error("Missing transport");
          }
      },
  };

  class BaseMetric {
      definition;
      system;
      transport;
      value;
      type;
      path = [];
      name;
      description;
      get repo() {
          return this.system?.repo;
      }
      get id() { return `${this.system.path}/${name}`; }
      constructor(definition, system, transport, value, type) {
          this.definition = definition;
          this.system = system;
          this.transport = transport;
          this.value = value;
          this.type = type;
          Helpers.validate(definition, system, transport);
          this.path = system.path.slice(0);
          this.path.push(system.name);
          this.name = definition.name;
          this.description = definition.description;
          transport.createMetric(this);
      }
      update(newValue) {
          this.value = newValue;
          return this.transport.updateMetric(this);
      }
  }

  class NumberMetric extends BaseMetric {
      constructor(definition, system, transport, value) {
          super(definition, system, transport, value, MetricTypes.NUMBER);
      }
      incrementBy(num) {
          this.update(this.value + num);
      }
      increment() {
          this.incrementBy(1);
      }
      decrement() {
          this.incrementBy(-1);
      }
      decrementBy(num) {
          this.incrementBy(num * -1);
      }
  }

  class ObjectMetric extends BaseMetric {
      constructor(definition, system, transport, value) {
          super(definition, system, transport, value, MetricTypes.OBJECT);
      }
      update(newValue) {
          this.mergeValues(newValue);
          return this.transport.updateMetric(this);
      }
      mergeValues(values) {
          return Object.keys(this.value).forEach((k) => {
              if (typeof values[k] !== "undefined") {
                  this.value[k] = values[k];
              }
          });
      }
  }

  class StringMetric extends BaseMetric {
      constructor(definition, system, transport, value) {
          super(definition, system, transport, value, MetricTypes.STRING);
      }
  }

  class TimestampMetric extends BaseMetric {
      constructor(definition, system, transport, value) {
          super(definition, system, transport, value, MetricTypes.TIMESTAMP);
      }
      now() {
          this.update(new Date());
      }
  }

  function system$1(name, repo, protocol, parent, description) {
      if (!repo) {
          throw new Error("Repository is required");
      }
      if (!protocol) {
          throw new Error("Transport is required");
      }
      const _transport = protocol;
      const _name = name;
      const _description = description || "";
      const _repo = repo;
      const _parent = parent;
      const _path = _buildPath(parent);
      let _state = {};
      const id = _arrayToString(_path, "/") + name;
      const root = repo.root;
      const _subSystems = [];
      const _metrics = [];
      function subSystem(nameSystem, descriptionSystem) {
          if (!nameSystem || nameSystem.length === 0) {
              throw new Error("name is required");
          }
          const match = _subSystems.filter((s) => s.name === nameSystem);
          if (match.length > 0) {
              return match[0];
          }
          const _system = system$1(nameSystem, _repo, _transport, me, descriptionSystem);
          _subSystems.push(_system);
          return _system;
      }
      function setState(state, stateDescription) {
          _state = { state, description: stateDescription };
          _transport.updateSystem(me, _state);
      }
      function stringMetric(definition, value) {
          return _getOrCreateMetric(definition, MetricTypes.STRING, value, (metricDef) => new StringMetric(metricDef, me, _transport, value));
      }
      function numberMetric(definition, value) {
          return _getOrCreateMetric(definition, MetricTypes.NUMBER, value, (metricDef) => new NumberMetric(metricDef, me, _transport, value));
      }
      function objectMetric(definition, value) {
          return _getOrCreateMetric(definition, MetricTypes.OBJECT, value, (metricDef) => new ObjectMetric(metricDef, me, _transport, value));
      }
      function timestampMetric(definition, value) {
          return _getOrCreateMetric(definition, MetricTypes.TIMESTAMP, value, (metricDef) => new TimestampMetric(metricDef, me, _transport, value));
      }
      function _getOrCreateMetric(metricObject, expectedType, value, createMetric) {
          let metricDef = { name: "" };
          if (typeof metricObject === "string") {
              metricDef = { name: metricObject };
          }
          else {
              metricDef = metricObject;
          }
          const matching = _metrics.filter((shadowedMetric) => shadowedMetric.name === metricDef.name);
          if (matching.length > 0) {
              const existing = matching[0];
              if (existing.type !== expectedType) {
                  throw new Error(`A metric named ${metricDef.name} is already defined with different type.`);
              }
              if (typeof value !== "undefined") {
                  existing
                      .update(value)
                      .catch(() => { });
              }
              return existing;
          }
          const metric = createMetric(metricDef);
          _metrics.push(metric);
          return metric;
      }
      function _buildPath(shadowedSystem) {
          if (!shadowedSystem || !shadowedSystem.parent) {
              return [];
          }
          const path = _buildPath(shadowedSystem.parent);
          path.push(shadowedSystem.name);
          return path;
      }
      function _arrayToString(path, separator) {
          return ((path && path.length > 0) ? path.join(separator) : "");
      }
      function getAggregateState() {
          const aggState = [];
          if (Object.keys(_state).length > 0) {
              aggState.push({
                  name: _name,
                  path: _path,
                  state: _state.state,
                  description: _state.description,
              });
          }
          _subSystems.forEach((shadowedSubSystem) => {
              const result = shadowedSubSystem.getAggregateState();
              if (result.length > 0) {
                  aggState.push(...result);
              }
          });
          return aggState;
      }
      const me = {
          get name() {
              return _name;
          },
          get description() {
              return _description;
          },
          get repo() {
              return _repo;
          },
          get parent() {
              return _parent;
          },
          path: _path,
          id,
          root,
          get subSystems() {
              return _subSystems;
          },
          get metrics() {
              return _metrics;
          },
          subSystem,
          getState: () => {
              return _state;
          },
          setState,
          stringMetric,
          timestampMetric,
          objectMetric,
          numberMetric,
          getAggregateState,
      };
      _transport.createSystem(me);
      return me;
  }

  class Repository {
      root;
      constructor(options, protocol) {
          protocol.init(this);
          this.root = system$1("", this, protocol);
          this.addSystemMetrics(this.root, options.clickStream || options.clickStream === undefined);
      }
      addSystemMetrics(rootSystem, useClickStream) {
          if (typeof navigator !== "undefined") {
              rootSystem.stringMetric("UserAgent", navigator.userAgent);
          }
          if (useClickStream && typeof document !== "undefined") {
              const clickStream = rootSystem.subSystem("ClickStream");
              const documentClickHandler = (e) => {
                  if (!e.target) {
                      return;
                  }
                  const target = e.target;
                  const className = target ? target.getAttribute("class") ?? "" : "";
                  clickStream.objectMetric("LastBrowserEvent", {
                      type: "click",
                      timestamp: new Date(),
                      target: {
                          className,
                          id: target.id,
                          type: "<" + target.tagName.toLowerCase() + ">",
                          href: target.href || "",
                      },
                  });
              };
              clickStream.objectMetric("Page", {
                  title: document.title,
                  page: window.location.href,
              });
              if (document.addEventListener) {
                  document.addEventListener("click", documentClickHandler);
              }
              else {
                  document.attachEvent("onclick", documentClickHandler);
              }
          }
          rootSystem.stringMetric("StartTime", (new Date()).toString());
          const urlMetric = rootSystem.stringMetric("StartURL", "");
          const appNameMetric = rootSystem.stringMetric("AppName", "");
          if (typeof window !== "undefined") {
              if (typeof window.location !== "undefined") {
                  const startUrl = window.location.href;
                  urlMetric.update(startUrl);
              }
              if (typeof window.glue42gd !== "undefined") {
                  appNameMetric.update(window.glue42gd.appName);
              }
          }
      }
  }

  class NullProtocol {
      init(repo) {
      }
      createSystem(system) {
          return Promise.resolve();
      }
      updateSystem(metric, state) {
          return Promise.resolve();
      }
      createMetric(metric) {
          return Promise.resolve();
      }
      updateMetric(metric) {
          return Promise.resolve();
      }
  }

  class PerfTracker {
      api;
      lastCount = 0;
      initialPublishTimeout = 10 * 1000;
      publishInterval = 60 * 1000;
      system;
      constructor(api, initialPublishTimeout, publishInterval) {
          this.api = api;
          this.initialPublishTimeout = initialPublishTimeout ?? this.initialPublishTimeout;
          this.publishInterval = publishInterval ?? this.publishInterval;
          this.scheduleCollection();
          this.system = this.api.subSystem("performance", "Performance data published by the web application");
      }
      scheduleCollection() {
          setTimeout(() => {
              this.collect();
              setInterval(() => {
                  this.collect();
              }, this.publishInterval);
          }, this.initialPublishTimeout);
      }
      collect() {
          try {
              this.collectMemory();
              this.collectEntries();
          }
          catch {
          }
      }
      collectMemory() {
          const memory = window.performance.memory;
          this.system.stringMetric("memory", JSON.stringify({
              totalJSHeapSize: memory.totalJSHeapSize,
              usedJSHeapSize: memory.usedJSHeapSize
          }));
      }
      collectEntries() {
          const allEntries = window.performance.getEntries();
          if (allEntries.length <= this.lastCount) {
              return;
          }
          this.lastCount = allEntries.length;
          const jsonfiedEntries = allEntries.map((i) => i.toJSON());
          this.system.stringMetric("entries", JSON.stringify(jsonfiedEntries));
      }
  }

  var metrics = (options) => {
      let protocol;
      if (!options.connection || typeof options.connection !== "object") {
          protocol = new NullProtocol();
      }
      else {
          protocol = gw3(options.connection, options);
      }
      const repo = new Repository(options, protocol);
      let rootSystem = repo.root;
      if (!options.disableAutoAppSystem) {
          rootSystem = rootSystem.subSystem("App");
      }
      const api = addFAVSupport(rootSystem);
      initPerf(api, options.pagePerformanceMetrics);
      return api;
  };
  function initPerf(api, config) {
      if (typeof window === "undefined") {
          return;
      }
      const perfConfig = window?.glue42gd?.metrics?.pagePerformanceMetrics;
      if (perfConfig) {
          config = perfConfig;
      }
      if (config?.enabled) {
          new PerfTracker(api, config.initialPublishTimeout, config.publishInterval);
      }
  }
  function addFAVSupport(system) {
      const reportingSystem = system.subSystem("reporting");
      const def = {
          name: "features"
      };
      let featureMetric;
      const featureMetricFunc = (name, action, payload) => {
          if (typeof name === "undefined" || name === "") {
              throw new Error("name is mandatory");
          }
          else if (typeof action === "undefined" || action === "") {
              throw new Error("action is mandatory");
          }
          else if (typeof payload === "undefined" || payload === "") {
              throw new Error("payload is mandatory");
          }
          if (!featureMetric) {
              featureMetric = reportingSystem.objectMetric(def, { name, action, payload });
          }
          else {
              featureMetric.update({
                  name,
                  action,
                  payload
              });
          }
      };
      system.featureMetric = featureMetricFunc;
      return system;
  }

  var commonjsGlobal$1 = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {};

  function getDefaultExportFromCjs$1 (x) {
  	return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, 'default') ? x['default'] : x;
  }

  function createRegistry$1(options) {
      if (options && options.errorHandling
          && typeof options.errorHandling !== "function"
          && options.errorHandling !== "log"
          && options.errorHandling !== "silent"
          && options.errorHandling !== "throw") {
          throw new Error("Invalid options passed to createRegistry. Prop errorHandling should be [\"log\" | \"silent\" | \"throw\" | (err) => void], but " + typeof options.errorHandling + " was passed");
      }
      var _userErrorHandler = options && typeof options.errorHandling === "function" && options.errorHandling;
      var callbacks = {};
      function add(key, callback, replayArgumentsArr) {
          var callbacksForKey = callbacks[key];
          if (!callbacksForKey) {
              callbacksForKey = [];
              callbacks[key] = callbacksForKey;
          }
          callbacksForKey.push(callback);
          if (replayArgumentsArr) {
              setTimeout(function () {
                  replayArgumentsArr.forEach(function (replayArgument) {
                      var _a;
                      if ((_a = callbacks[key]) === null || _a === void 0 ? void 0 : _a.includes(callback)) {
                          try {
                              if (Array.isArray(replayArgument)) {
                                  callback.apply(undefined, replayArgument);
                              }
                              else {
                                  callback.apply(undefined, [replayArgument]);
                              }
                          }
                          catch (err) {
                              _handleError(err, key);
                          }
                      }
                  });
              }, 0);
          }
          return function () {
              var allForKey = callbacks[key];
              if (!allForKey) {
                  return;
              }
              allForKey = allForKey.reduce(function (acc, element, index) {
                  if (!(element === callback && acc.length === index)) {
                      acc.push(element);
                  }
                  return acc;
              }, []);
              if (allForKey.length === 0) {
                  delete callbacks[key];
              }
              else {
                  callbacks[key] = allForKey;
              }
          };
      }
      function execute(key) {
          var argumentsArr = [];
          for (var _i = 1; _i < arguments.length; _i++) {
              argumentsArr[_i - 1] = arguments[_i];
          }
          var callbacksForKey = callbacks[key];
          if (!callbacksForKey || callbacksForKey.length === 0) {
              return [];
          }
          var results = [];
          callbacksForKey.forEach(function (callback) {
              try {
                  var result = callback.apply(undefined, argumentsArr);
                  results.push(result);
              }
              catch (err) {
                  results.push(undefined);
                  _handleError(err, key);
              }
          });
          return results;
      }
      function _handleError(exceptionArtifact, key) {
          var errParam = exceptionArtifact instanceof Error ? exceptionArtifact : new Error(exceptionArtifact);
          if (_userErrorHandler) {
              _userErrorHandler(errParam);
              return;
          }
          var msg = "[ERROR] callback-registry: User callback for key \"" + key + "\" failed: " + errParam.stack;
          if (options) {
              switch (options.errorHandling) {
                  case "log":
                      return console.error(msg);
                  case "silent":
                      return;
                  case "throw":
                      throw new Error(msg);
              }
          }
          console.error(msg);
      }
      function clear() {
          callbacks = {};
      }
      function clearKey(key) {
          var callbacksForKey = callbacks[key];
          if (!callbacksForKey) {
              return;
          }
          delete callbacks[key];
      }
      return {
          add: add,
          execute: execute,
          clear: clear,
          clearKey: clearKey
      };
  }
  createRegistry$1.default = createRegistry$1;
  var lib$1 = createRegistry$1;


  var CallbackRegistryFactory$1 = /*@__PURE__*/getDefaultExportFromCjs$1(lib$1);

  class InProcTransport {
      gw;
      registry = CallbackRegistryFactory$1();
      client;
      constructor(settings, logger) {
          this.gw = settings.facade;
          this.gw.connect((_client, message) => {
              this.messageHandler(message);
          }).then((client) => {
              this.client = client;
          });
      }
      get isObjectBasedTransport() {
          return true;
      }
      sendObject(msg) {
          if (this.client) {
              this.client.send(msg);
              return Promise.resolve(undefined);
          }
          else {
              return Promise.reject(`not connected`);
          }
      }
      send(_msg) {
          return Promise.reject("not supported");
      }
      onMessage(callback) {
          return this.registry.add("onMessage", callback);
      }
      onConnectedChanged(callback) {
          callback(true);
          return () => { };
      }
      close() {
          return Promise.resolve();
      }
      open() {
          return Promise.resolve();
      }
      name() {
          return "in-memory";
      }
      reconnect() {
          return Promise.resolve();
      }
      messageHandler(msg) {
          this.registry.execute("onMessage", msg);
      }
  }

  class SharedWorkerTransport {
      logger;
      worker;
      registry = CallbackRegistryFactory$1();
      constructor(workerFile, logger) {
          this.logger = logger;
          this.worker = new SharedWorker(workerFile);
          this.worker.port.onmessage = (e) => {
              this.messageHandler(e.data);
          };
      }
      get isObjectBasedTransport() {
          return true;
      }
      sendObject(msg) {
          this.worker.port.postMessage(msg);
          return Promise.resolve();
      }
      send(_msg) {
          return Promise.reject("not supported");
      }
      onMessage(callback) {
          return this.registry.add("onMessage", callback);
      }
      onConnectedChanged(callback) {
          callback(true);
          return () => { };
      }
      close() {
          return Promise.resolve();
      }
      open() {
          return Promise.resolve();
      }
      name() {
          return "shared-worker";
      }
      reconnect() {
          return Promise.resolve();
      }
      messageHandler(msg) {
          this.registry.execute("onMessage", msg);
      }
  }

  let Utils$1 = class Utils {
      static isNode() {
          if (typeof Utils._isNode !== "undefined") {
              return Utils._isNode;
          }
          if (typeof window !== "undefined") {
              Utils._isNode = false;
              return false;
          }
          try {
              Utils._isNode = Object.prototype.toString.call(global.process) === "[object process]";
          }
          catch (e) {
              Utils._isNode = false;
          }
          return Utils._isNode;
      }
      static _isNode;
  };

  let PromiseWrapper$1 = class PromiseWrapper {
      static delay(time) {
          return new Promise((resolve) => setTimeout(resolve, time));
      }
      resolve;
      reject;
      promise;
      rejected = false;
      resolved = false;
      get ended() {
          return this.rejected || this.resolved;
      }
      constructor() {
          this.promise = new Promise((resolve, reject) => {
              this.resolve = (t) => {
                  this.resolved = true;
                  resolve(t);
              };
              this.reject = (err) => {
                  this.rejected = true;
                  reject(err);
              };
          });
      }
  };

  const timers = {};
  function getAllTimers() {
      return timers;
  }
  function timer (timerName) {
      const existing = timers[timerName];
      if (existing) {
          return existing;
      }
      const marks = [];
      function now() {
          return new Date().getTime();
      }
      const startTime = now();
      mark("start", startTime);
      let endTime;
      let period;
      function stop() {
          endTime = now();
          mark("end", endTime);
          period = endTime - startTime;
          return period;
      }
      function mark(name, time) {
          const currentTime = time ?? now();
          let diff = 0;
          if (marks.length > 0) {
              diff = currentTime - marks[marks.length - 1].time;
          }
          marks.push({ name, time: currentTime, diff });
      }
      const timerObj = {
          get startTime() {
              return startTime;
          },
          get endTime() {
              return endTime;
          },
          get period() {
              return period;
          },
          stop,
          mark,
          marks
      };
      timers[timerName] = timerObj;
      return timerObj;
  }

  const WebSocketConstructor = Utils$1.isNode() ? require("ws") : window.WebSocket;
  class WS {
      ws;
      logger;
      settings;
      startupTimer = timer("connection");
      _running = true;
      _registry = CallbackRegistryFactory$1();
      wsRequests = [];
      constructor(settings, logger) {
          this.settings = settings;
          this.logger = logger;
          if (!this.settings.ws) {
              throw new Error("ws is missing");
          }
      }
      onMessage(callback) {
          return this._registry.add("onMessage", callback);
      }
      send(msg, options) {
          return new Promise((resolve, reject) => {
              this.waitForSocketConnection(() => {
                  try {
                      this.ws?.send(msg);
                      resolve();
                  }
                  catch (e) {
                      reject(e);
                  }
              }, reject);
          });
      }
      open() {
          this.logger.info("opening ws...");
          this._running = true;
          return new Promise((resolve, reject) => {
              this.waitForSocketConnection(resolve, reject);
          });
      }
      close() {
          this._running = false;
          if (this.ws) {
              this.ws.close();
          }
          return Promise.resolve();
      }
      onConnectedChanged(callback) {
          return this._registry.add("onConnectedChanged", callback);
      }
      name() {
          return this.settings.ws;
      }
      reconnect() {
          this.ws?.close();
          const pw = new PromiseWrapper$1();
          this.waitForSocketConnection(() => {
              pw.resolve();
          });
          return pw.promise;
      }
      waitForSocketConnection(callback, failed) {
          failed = failed ?? (() => { });
          if (!this._running) {
              failed(`wait for socket on ${this.settings.ws} failed - socket closed by user`);
              return;
          }
          if (this.ws?.readyState === 1) {
              callback();
              return;
          }
          this.wsRequests.push({ callback, failed });
          if (this.wsRequests.length > 1) {
              return;
          }
          this.openSocket();
      }
      async openSocket(retryInterval, retriesLeft) {
          this.logger.info(`opening ws to ${this.settings.ws}, retryInterval: ${retryInterval}, retriesLeft: ${retriesLeft}...`);
          this.startupTimer.mark("opening-socket");
          if (retryInterval === undefined) {
              retryInterval = this.settings.reconnectInterval;
          }
          if (typeof retriesLeft === "undefined") {
              retriesLeft = this.settings.reconnectAttempts;
          }
          if (retriesLeft !== undefined) {
              if (retriesLeft === 0) {
                  this.notifyForSocketState(`wait for socket on ${this.settings.ws} failed - no more retries left`);
                  return;
              }
              this.logger.debug(`will retry ${retriesLeft} more times (every ${retryInterval} ms)`);
          }
          try {
              await this.initiateSocket();
              this.startupTimer.mark("socket-initiated");
              this.notifyForSocketState();
          }
          catch {
              setTimeout(() => {
                  const retries = retriesLeft === undefined ? undefined : retriesLeft - 1;
                  this.openSocket(retryInterval, retries);
              }, retryInterval);
          }
      }
      initiateSocket() {
          const pw = new PromiseWrapper$1();
          this.logger.debug(`initiating ws to ${this.settings.ws}...`);
          this.ws = new WebSocketConstructor(this.settings.ws ?? "");
          this.ws.onerror = (err) => {
              let reason = "";
              try {
                  reason = JSON.stringify(err);
              }
              catch (error) {
                  const seen = new WeakSet();
                  const replacer = (key, value) => {
                      if (typeof value === "object" && value !== null) {
                          if (seen.has(value)) {
                              return;
                          }
                          seen.add(value);
                      }
                      return value;
                  };
                  reason = JSON.stringify(err, replacer);
              }
              this.logger.info(`ws error - reason: ${reason}`);
              pw.reject("error");
              this.notifyStatusChanged(false, reason);
          };
          this.ws.onclose = (err) => {
              this.logger.info(`ws closed - code: ${err?.code} reason: ${err?.reason}`);
              pw.reject("closed");
              this.notifyStatusChanged(false);
          };
          this.ws.onopen = () => {
              this.startupTimer.mark("ws-opened");
              this.logger.info(`ws opened ${this.settings.identity?.application}`);
              pw.resolve();
              this.notifyStatusChanged(true);
          };
          this.ws.onmessage = (message) => {
              this._registry.execute("onMessage", message.data);
          };
          return pw.promise;
      }
      notifyForSocketState(error) {
          this.wsRequests.forEach((wsRequest) => {
              if (error) {
                  if (wsRequest.failed) {
                      wsRequest.failed(error);
                  }
              }
              else {
                  wsRequest.callback();
              }
          });
          this.wsRequests = [];
      }
      notifyStatusChanged(status, reason) {
          this._registry.execute("onConnectedChanged", status, reason);
      }
  }

  class MessageReplayerImpl {
      specs;
      specsNames = [];
      messages = {};
      isDone;
      subs = {};
      subsRefCount = {};
      connection;
      constructor(specs) {
          this.specs = {};
          for (const spec of specs) {
              this.specs[spec.name] = spec;
              this.specsNames.push(spec.name);
          }
      }
      init(connection) {
          this.connection = connection;
          for (const name of this.specsNames) {
              for (const type of this.specs[name].types) {
                  let refCount = this.subsRefCount[type];
                  if (!refCount) {
                      refCount = 0;
                  }
                  refCount += 1;
                  this.subsRefCount[type] = refCount;
                  if (refCount > 1) {
                      continue;
                  }
                  const sub = connection.on(type, (msg) => this.processMessage(type, msg));
                  this.subs[type] = sub;
              }
          }
      }
      processMessage(type, msg) {
          if (this.isDone || !msg) {
              return;
          }
          for (const name of this.specsNames) {
              if (this.specs[name].types.indexOf(type) !== -1) {
                  const messages = this.messages[name] || [];
                  this.messages[name] = messages;
                  messages.push(msg);
              }
          }
      }
      drain(name, callback) {
          if (callback) {
              (this.messages[name] || []).forEach(callback);
          }
          delete this.messages[name];
          for (const type of this.specs[name].types) {
              this.subsRefCount[type] -= 1;
              if (this.subsRefCount[type] <= 0) {
                  this.connection?.off(this.subs[type]);
                  delete this.subs[type];
                  delete this.subsRefCount[type];
              }
          }
          delete this.specs[name];
          if (!this.specs.length) {
              this.isDone = true;
          }
      }
  }

  let urlAlphabet$1 =
    'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict';
  let nanoid$1 = (size = 21) => {
    let id = '';
    let i = size;
    while (i--) {
      id += urlAlphabet$1[(Math.random() * 64) | 0];
    }
    return id
  };

  const PromisePlus$1 = (executor, timeoutMilliseconds, timeoutMessage) => {
      return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
              const message = timeoutMessage || `Promise timeout hit: ${timeoutMilliseconds}`;
              reject(message);
          }, timeoutMilliseconds);
          const providedPromise = new Promise(executor);
          providedPromise
              .then((result) => {
              clearTimeout(timeout);
              resolve(result);
          })
              .catch((error) => {
              clearTimeout(timeout);
              reject(error);
          });
      });
  };

  class WebPlatformTransport {
      settings;
      logger;
      identity;
      isPreferredActivated;
      _communicationId;
      publicWindowId;
      selfAssignedWindowId;
      iAmConnected = false;
      parentReady = false;
      rejected = false;
      parentPingResolve;
      parentPingInterval;
      connectionResolve;
      extConnectionResolve;
      extConnectionReject;
      connectionReject;
      port;
      myClientId;
      children = [];
      extContentAvailable = false;
      extContentConnecting = false;
      extContentConnected = false;
      parentWindowId;
      parentInExtMode = false;
      webNamespace = "g42_core_web";
      parent;
      parentType;
      parentPingTimeout = 5000;
      connectionRequestTimeout = 7000;
      defaultTargetString = "*";
      registry = CallbackRegistryFactory$1();
      messages = {
          connectionAccepted: { name: "connectionAccepted", handle: this.handleConnectionAccepted.bind(this) },
          connectionRejected: { name: "connectionRejected", handle: this.handleConnectionRejected.bind(this) },
          connectionRequest: { name: "connectionRequest", handle: this.handleConnectionRequest.bind(this) },
          parentReady: {
              name: "parentReady", handle: () => {
              }
          },
          parentPing: { name: "parentPing", handle: this.handleParentPing.bind(this) },
          platformPing: { name: "platformPing", handle: this.handlePlatformPing.bind(this) },
          platformReady: { name: "platformReady", handle: this.handlePlatformReady.bind(this) },
          clientUnload: { name: "clientUnload", handle: this.handleClientUnload.bind(this) },
          manualUnload: { name: "manualUnload", handle: this.handleManualUnload.bind(this) },
          extConnectionResponse: { name: "extConnectionResponse", handle: this.handleExtConnectionResponse.bind(this) },
          extSetupRequest: { name: "extSetupRequest", handle: this.handleExtSetupRequest.bind(this) },
          gatewayDisconnect: { name: "gatewayDisconnect", handle: this.handleGatewayDisconnect.bind(this) },
          gatewayInternalConnect: { name: "gatewayInternalConnect", handle: this.handleGatewayInternalConnect.bind(this) }
      };
      constructor(settings, logger, identity) {
          this.settings = settings;
          this.logger = logger;
          this.identity = identity;
          this.extContentAvailable = !!window.glue42ext;
          this.setUpMessageListener();
          this.setUpUnload();
          this.setupPlatformUnloadListener();
          this.parentType = window.name.includes("#wsp") ? "workspace" : undefined;
      }
      manualSetReadyState() {
          this.iAmConnected = true;
          this.parentReady = true;
      }
      get transportWindowId() {
          return this.publicWindowId;
      }
      get communicationId() {
          return this._communicationId;
      }
      async sendObject(msg) {
          if (this.extContentConnected) {
              return window.postMessage({ glue42ExtOut: msg }, this.defaultTargetString);
          }
          if (!this.port) {
              throw new Error("Cannot send message, because the port was not opened yet");
          }
          this.port.postMessage(msg);
      }
      get isObjectBasedTransport() {
          return true;
      }
      onMessage(callback) {
          return this.registry.add("onMessage", callback);
      }
      send() {
          return Promise.reject("not supported");
      }
      onConnectedChanged(callback) {
          return this.registry.add("onConnectedChanged", callback);
      }
      async open() {
          this.logger.debug("opening a connection to the web platform gateway.");
          await this.connect();
          this.notifyStatusChanged(true);
      }
      close() {
          const message = {
              glue42core: {
                  type: this.messages.gatewayDisconnect.name,
                  data: {
                      clientId: this.myClientId,
                      ownWindowId: this.identity?.windowId
                  }
              }
          };
          this.port?.postMessage(message);
          this.parentReady = false;
          this.notifyStatusChanged(false, "manual reconnection");
          return Promise.resolve();
      }
      name() {
          return "web-platform";
      }
      async reconnect() {
          await this.close();
          return Promise.resolve();
      }
      initiateInternalConnection() {
          return new Promise((resolve, reject) => {
              this.logger.debug("opening an internal web platform connection");
              this.port = this.settings.port;
              if (this.iAmConnected) {
                  this.logger.warn("cannot open a new connection, because this client is currently connected");
                  return;
              }
              this.port.onmessage = (event) => {
                  if (this.iAmConnected && !event.data?.glue42core) {
                      this.registry.execute("onMessage", event.data);
                      return;
                  }
                  const data = event.data?.glue42core;
                  if (!data) {
                      return;
                  }
                  if (data.type === this.messages.gatewayInternalConnect.name && data.success) {
                      this.publicWindowId = this.settings.windowId;
                      if (this.identity && this.publicWindowId) {
                          this.identity.windowId = this.publicWindowId;
                          this.identity.instance = this.publicWindowId;
                      }
                      resolve();
                  }
                  if (data.type === this.messages.gatewayInternalConnect.name && data.error) {
                      reject(data.error);
                  }
              };
              this.port.postMessage({
                  glue42core: {
                      type: this.messages.gatewayInternalConnect.name
                  }
              });
          });
      }
      initiateRemoteConnection(target) {
          return PromisePlus$1((resolve, reject) => {
              this.connectionResolve = resolve;
              this.connectionReject = reject;
              this.myClientId = this.myClientId ?? nanoid$1(10);
              const bridgeInstanceId = this.getMyWindowId() || nanoid$1(10);
              const request = {
                  glue42core: {
                      type: this.messages.connectionRequest.name,
                      clientId: this.myClientId,
                      clientType: "child",
                      bridgeInstanceId,
                      selfAssignedWindowId: this.selfAssignedWindowId
                  }
              };
              this.logger.debug("sending connection request");
              if (this.extContentConnecting) {
                  request.glue42core.clientType = "child";
                  request.glue42core.bridgeInstanceId = this.myClientId;
                  request.glue42core.parentWindowId = this.parentWindowId;
                  return window.postMessage(request, this.defaultTargetString);
              }
              if (!target) {
                  throw new Error("Cannot send a connection request, because no glue target was specified!");
              }
              target.postMessage(request, this.defaultTargetString);
          }, this.connectionRequestTimeout, "The connection to the target glue window timed out");
      }
      async isParentCheckSuccess(parentCheck) {
          try {
              await parentCheck;
              return { success: true };
          }
          catch (error) {
              return { success: false };
          }
      }
      setUpMessageListener() {
          if (this.settings.port) {
              this.logger.debug("skipping generic message listener, because this is an internal client");
              return;
          }
          window.addEventListener("message", (event) => {
              const data = event.data?.glue42core;
              if (!data || this.rejected) {
                  return;
              }
              const allowedOrigins = this.settings.allowedOrigins || [];
              if (allowedOrigins.length && !allowedOrigins.includes(event.origin)) {
                  this.logger.warn(`received a message from an origin which is not in the allowed list: ${event.origin}`);
                  return;
              }
              if (!this.checkMessageTypeValid(data.type)) {
                  this.logger.error(`cannot handle the incoming glue42 core message, because the type is invalid: ${data.type}`);
                  return;
              }
              const messageType = data.type;
              this.logger.debug(`received valid glue42core message of type: ${messageType}`);
              this.messages[messageType].handle(event);
          });
      }
      setUpUnload() {
          if (this.settings.port) {
              this.logger.debug("skipping unload event listener, because this is an internal client");
              return;
          }
          window.addEventListener("beforeunload", () => {
              if (this.extContentConnected) {
                  return;
              }
              const message = {
                  glue42core: {
                      type: this.messages.clientUnload.name,
                      data: {
                          clientId: this.myClientId,
                          ownWindowId: this.identity?.windowId
                      }
                  }
              };
              if (this.parent) {
                  this.parent.postMessage(message, this.defaultTargetString);
              }
              this.port?.postMessage(message);
          });
      }
      handlePlatformReady(event) {
          this.logger.debug("the web platform gave the ready signal");
          this.parentReady = true;
          if (this.parentPingResolve) {
              this.parentPingResolve();
              delete this.parentPingResolve;
          }
          if (this.parentPingInterval) {
              clearInterval(this.parentPingInterval);
              delete this.parentPingInterval;
          }
          this.parent = event.source;
          this.parentType = window.name.includes("#wsp") ? "workspace" : "window";
      }
      handleConnectionAccepted(event) {
          const data = event.data?.glue42core;
          if (this.myClientId === data.clientId) {
              return this.handleAcceptanceOfMyRequest(data);
          }
          return this.handleAcceptanceOfGrandChildRequest(data, event);
      }
      handleAcceptanceOfMyRequest(data) {
          this.logger.debug("handling a connection accepted signal targeted at me.");
          this.isPreferredActivated = data.isPreferredActivated;
          if (this.extContentConnecting) {
              return this.processExtContentConnection(data);
          }
          if (!data.port) {
              this.logger.error("cannot set up my connection, because I was not provided with a port");
              return;
          }
          this.publicWindowId = this.getMyWindowId();
          if (this.identity) {
              this.identity.windowId = this.publicWindowId;
              this.identity.instance = this.identity.instance ? this.identity.instance : this.publicWindowId || nanoid$1(10);
          }
          if (this.identity && data.appName) {
              this.identity.application = data.appName;
              this.identity.applicationName = data.appName;
          }
          this._communicationId = data.communicationId;
          this.port = data.port;
          this.port.onmessage = (e) => this.registry.execute("onMessage", e.data);
          if (this.connectionResolve) {
              this.logger.debug("my connection is set up, calling the connection resolve.");
              this.connectionResolve();
              delete this.connectionResolve;
              return;
          }
          this.logger.error("unable to call the connection resolve, because no connection promise was found");
      }
      processExtContentConnection(data) {
          this.logger.debug("handling a connection accepted signal targeted at me for extension content connection.");
          this.extContentConnecting = false;
          this.extContentConnected = true;
          this.publicWindowId = this.parentWindowId || this.myClientId;
          if (this.extContentConnecting && this.identity) {
              this.identity.windowId = this.publicWindowId;
          }
          if (this.identity && data.appName) {
              this.identity.application = data.appName;
              this.identity.applicationName = data.appName;
          }
          window.addEventListener("message", (event) => {
              const extData = event.data?.glue42ExtInc;
              if (!extData) {
                  return;
              }
              const allowedOrigins = this.settings.allowedOrigins || [];
              if (allowedOrigins.length && !allowedOrigins.includes(event.origin)) {
                  this.logger.warn(`received a message from an origin which is not in the allowed list: ${event.origin}`);
                  return;
              }
              this.registry.execute("onMessage", extData);
          });
          if (this.connectionResolve) {
              this.logger.debug("my connection is set up, calling the connection resolve.");
              this.connectionResolve();
              delete this.connectionResolve;
              return;
          }
      }
      handleAcceptanceOfGrandChildRequest(data, event) {
          if (this.extContentConnecting || this.extContentConnected) {
              this.logger.debug("cannot process acceptance of a grandchild, because I am connected to a content script");
              return;
          }
          this.logger.debug(`handling a connection accepted signal targeted at a grandchild: ${data.clientId}`);
          const child = this.children.find((c) => c.grandChildId === data.clientId);
          if (!child) {
              this.logger.error(`cannot handle connection accepted for grandchild: ${data.clientId}, because there is no grandchild with this id`);
              return;
          }
          child.connected = true;
          this.logger.debug(`the grandchild connection for ${data.clientId} is set up, forwarding the success message and the gateway port`);
          data.parentWindowId = this.publicWindowId;
          child.source.postMessage(event.data, child.origin, [data.port]);
          return;
      }
      handleConnectionRejected(event) {
          this.logger.debug("handling a connection rejection. Most likely the reason is that this window was not created by a glue API call");
          if (!this.connectionReject) {
              return;
          }
          const errorMsg = typeof event.data.glue42core?.error === "string"
              ? `Connection was rejected. ${event.data.glue42core?.error}`
              : "The platform connection was rejected. Most likely because this window was not created by a glue API call";
          this.connectionReject(errorMsg);
          delete this.connectionReject;
      }
      handleConnectionRequest(event) {
          if (this.extContentConnecting) {
              this.logger.debug("This connection request event is targeted at the extension content");
              return;
          }
          const source = event.source;
          const data = event.data.glue42core;
          if (!data.clientType || data.clientType !== "grandChild") {
              return this.rejectConnectionRequest(source, event.origin, "rejecting a connection request, because the source was not opened by a glue API call");
          }
          if (!data.clientId) {
              return this.rejectConnectionRequest(source, event.origin, "rejecting a connection request, because the source did not provide a valid id");
          }
          if (!this.parent) {
              return this.rejectConnectionRequest(source, event.origin, "Cannot forward the connection request, because no direct connection to the platform was found");
          }
          this.logger.debug(`handling a connection request for a grandchild: ${data.clientId}`);
          this.children.push({ grandChildId: data.clientId, source, connected: false, origin: event.origin });
          this.logger.debug(`grandchild: ${data.clientId} is prepared, forwarding connection request to the platform`);
          this.parent.postMessage(event.data, this.defaultTargetString);
      }
      handleParentPing(event) {
          if (!this.parentReady) {
              this.logger.debug("my parent is not ready, I am ignoring the parent ping");
              return;
          }
          if (!this.iAmConnected) {
              this.logger.debug("i am not fully connected yet, I am ignoring the parent ping");
              return;
          }
          const message = {
              glue42core: {
                  type: this.messages.parentReady.name
              }
          };
          if (this.extContentConnected) {
              message.glue42core.extMode = { windowId: this.myClientId };
          }
          const source = event.source;
          this.logger.debug("responding to a parent ping with a ready message");
          source.postMessage(message, event.origin);
      }
      setupPlatformUnloadListener() {
          this.onMessage((msg) => {
              if (msg.type === "platformUnload") {
                  this.logger.debug("detected a web platform unload");
                  this.parentReady = false;
                  this.notifyStatusChanged(false, "Gateway unloaded");
              }
          });
      }
      handleManualUnload() {
          const message = {
              glue42core: {
                  type: this.messages.clientUnload.name,
                  data: {
                      clientId: this.myClientId,
                      ownWindowId: this.identity?.windowId
                  }
              }
          };
          if (this.extContentConnected) {
              return window.postMessage({ glue42ExtOut: message }, this.defaultTargetString);
          }
          this.port?.postMessage(message);
      }
      handleClientUnload(event) {
          const data = event.data.glue42core;
          const clientId = data?.data.clientId;
          if (!clientId) {
              this.logger.warn("cannot process grand child unload, because the provided id was not valid");
              return;
          }
          const foundChild = this.children.find((child) => child.grandChildId === clientId);
          if (!foundChild) {
              this.logger.warn("cannot process grand child unload, because this client is unaware of this grandchild");
              return;
          }
          this.logger.debug(`handling grandchild unload for id: ${clientId}`);
          this.children = this.children.filter((child) => child.grandChildId !== clientId);
      }
      handlePlatformPing() {
          return;
      }
      notifyStatusChanged(status, reason) {
          this.iAmConnected = status;
          this.registry.execute("onConnectedChanged", status, reason);
      }
      checkMessageTypeValid(typeToValidate) {
          return typeof typeToValidate === "string" && !!this.messages[typeToValidate];
      }
      rejectConnectionRequest(source, origin, reason) {
          this.rejected = true;
          this.logger.error(reason);
          const rejection = {
              glue42core: {
                  type: this.messages.connectionRejected.name
              }
          };
          source.postMessage(rejection, origin);
      }
      requestConnectionPermissionFromExt() {
          return this.waitForContentScript()
              .then(() => PromisePlus$1((resolve, reject) => {
              this.extConnectionResolve = resolve;
              this.extConnectionReject = reject;
              const message = {
                  glue42core: {
                      type: "extSetupRequest"
                  }
              };
              this.logger.debug("permission request to the extension content script was sent");
              window.postMessage(message, this.defaultTargetString);
          }, this.parentPingTimeout, "Cannot initialize glue, because this app was not opened or created by a Glue Client and the request for extension connection timed out"));
      }
      handleExtConnectionResponse(event) {
          const data = event.data?.glue42core;
          if (!data.approved) {
              return this.extConnectionReject ? this.extConnectionReject("Cannot initialize glue, because this app was not opened or created by a Glue Client and the request for extension connection was rejected") : undefined;
          }
          if (this.extConnectionResolve) {
              this.extConnectionResolve();
              delete this.extConnectionResolve;
          }
          this.extContentConnecting = true;
          this.parentType = "extension";
          this.logger.debug("The extension connection was approved, proceeding.");
      }
      handleExtSetupRequest() {
          return;
      }
      handleGatewayDisconnect() {
          return;
      }
      handleGatewayInternalConnect() {
          return;
      }
      waitForContentScript() {
          const contentReady = !!window.glue42ext?.content;
          if (contentReady) {
              return Promise.resolve();
          }
          return PromisePlus$1((resolve) => {
              window.addEventListener("Glue42EXTReady", () => {
                  resolve();
              });
          }, this.connectionRequestTimeout, "The content script was available, but was never heard to be ready");
      }
      async connect() {
          if (this.settings.port) {
              await this.initiateInternalConnection();
              this.logger.debug("internal web platform connection completed");
              return;
          }
          this.logger.debug("opening a client web platform connection");
          await this.findParent();
          await this.initiateRemoteConnection(this.parent);
          this.logger.debug("the client is connected");
      }
      async findParent() {
          const connectionNotPossibleMsg = "Cannot initiate glue, because this window was not opened or created by a glue client";
          const myInsideParents = this.getPossibleParentsInWindow(window);
          const myOutsideParents = this.getPossibleParentsOutsideWindow(window.top?.opener, window.top);
          const uniqueParents = new Set([...myInsideParents, ...myOutsideParents]);
          if (!uniqueParents.size && !this.extContentAvailable) {
              throw new Error(connectionNotPossibleMsg);
          }
          if (!uniqueParents.size && this.extContentAvailable) {
              await this.requestConnectionPermissionFromExt();
              return;
          }
          const defaultParentCheck = await this.isParentCheckSuccess(this.confirmParent(Array.from(uniqueParents)));
          if (defaultParentCheck.success) {
              this.logger.debug("The default parent was found!");
              return;
          }
          if (!this.extContentAvailable) {
              throw new Error(connectionNotPossibleMsg);
          }
          await this.requestConnectionPermissionFromExt();
      }
      getPossibleParentsInWindow(currentWindow) {
          return (!currentWindow?.parent || currentWindow === currentWindow.parent) ? [] : [currentWindow.parent, ...this.getPossibleParentsInWindow(currentWindow.parent)];
      }
      getPossibleParentsOutsideWindow(opener, current) {
          return (!opener || !current || opener === current) ? [] : [opener, ...this.getPossibleParentsInWindow(opener), ...this.getPossibleParentsOutsideWindow(opener.opener, opener)];
      }
      confirmParent(targets) {
          const connectionNotPossibleMsg = "Cannot initiate glue, because this window was not opened or created by a glue client";
          const parentCheck = PromisePlus$1((resolve) => {
              this.parentPingResolve = resolve;
              const message = {
                  glue42core: {
                      type: this.messages.platformPing.name
                  }
              };
              this.parentPingInterval = setInterval(() => {
                  targets.forEach((target) => {
                      target.postMessage(message, this.defaultTargetString);
                  });
              }, 1000);
          }, this.parentPingTimeout, connectionNotPossibleMsg);
          parentCheck.catch(() => {
              if (this.parentPingInterval) {
                  clearInterval(this.parentPingInterval);
                  delete this.parentPingInterval;
              }
          });
          return parentCheck;
      }
      getMyWindowId() {
          if (this.parentType === "workspace") {
              return window.name.substring(0, window.name.indexOf("#wsp"));
          }
          if (window !== window.top) {
              return;
          }
          if (window.name?.includes("g42")) {
              return window.name;
          }
          this.selfAssignedWindowId = this.selfAssignedWindowId || `g42-${nanoid$1(10)}`;
          return this.selfAssignedWindowId;
      }
  }

  const waitForInvocations = (invocations, callback) => {
      let left = invocations;
      return () => {
          left--;
          if (left === 0) {
              callback();
          }
      };
  };

  class AsyncSequelizer {
      minSequenceInterval;
      queue = [];
      isExecutingQueue = false;
      constructor(minSequenceInterval = 0) {
          this.minSequenceInterval = minSequenceInterval;
      }
      enqueue(action) {
          return new Promise((resolve, reject) => {
              this.queue.push({ action, resolve, reject });
              this.executeQueue();
          });
      }
      async executeQueue() {
          if (this.isExecutingQueue) {
              return;
          }
          this.isExecutingQueue = true;
          while (this.queue.length) {
              const operation = this.queue.shift();
              if (!operation) {
                  this.isExecutingQueue = false;
                  return;
              }
              try {
                  const actionResult = await operation.action();
                  operation.resolve(actionResult);
              }
              catch (error) {
                  operation.reject(error);
              }
              await this.intervalBreak();
          }
          this.isExecutingQueue = false;
      }
      intervalBreak() {
          return new Promise((res) => setTimeout(res, this.minSequenceInterval));
      }
  }

  function domainSession (domain, connection, logger, successMessages, errorMessages) {
      if (domain == null) {
          domain = "global";
      }
      successMessages = successMessages ?? ["success"];
      errorMessages = errorMessages ?? ["error"];
      let isJoined = domain === "global";
      let tryReconnecting = false;
      let _latestOptions;
      let _connectionOn = false;
      const callbacks = CallbackRegistryFactory$1();
      connection.disconnected(handleConnectionDisconnected);
      connection.loggedIn(handleConnectionLoggedIn);
      connection.on("success", (msg) => handleSuccessMessage(msg));
      connection.on("error", (msg) => handleErrorMessage(msg));
      connection.on("result", (msg) => handleSuccessMessage(msg));
      if (successMessages) {
          successMessages.forEach((sm) => {
              connection.on(sm, (msg) => handleSuccessMessage(msg));
          });
      }
      if (errorMessages) {
          errorMessages.forEach((sm) => {
              connection.on(sm, (msg) => handleErrorMessage(msg));
          });
      }
      const requestsMap = {};
      function join(options) {
          _latestOptions = options;
          return new Promise((resolve, reject) => {
              if (isJoined) {
                  resolve({});
                  return;
              }
              let joinPromise;
              if (domain === "global") {
                  joinPromise = _connectionOn ? Promise.resolve({}) : Promise.reject("not connected to gateway");
              }
              else {
                  logger.debug(`joining domain ${domain}`);
                  const joinMsg = {
                      type: "join",
                      destination: domain,
                      domain: "global",
                      options,
                  };
                  joinPromise = send(joinMsg);
              }
              joinPromise
                  .then(() => {
                  handleJoined();
                  resolve({});
              })
                  .catch((err) => {
                  logger.debug("error joining " + domain + " domain: " + JSON.stringify(err));
                  reject(err);
              });
          });
      }
      function leave() {
          if (domain === "global") {
              return Promise.resolve();
          }
          logger.debug("stopping session " + domain + "...");
          const leaveMsg = {
              type: "leave",
              destination: domain,
              domain: "global",
          };
          tryReconnecting = false;
          return send(leaveMsg)
              .then(() => {
              isJoined = false;
              callbacks.execute("onLeft");
          })
              .catch(() => {
              isJoined = false;
              callbacks.execute("onLeft");
          });
      }
      function handleJoined() {
          logger.debug("did join " + domain);
          isJoined = true;
          const wasReconnect = tryReconnecting;
          tryReconnecting = false;
          callbacks.execute("onJoined", wasReconnect);
      }
      function handleConnectionDisconnected() {
          _connectionOn = false;
          logger.debug("connection is down");
          isJoined = false;
          tryReconnecting = true;
          callbacks.execute("onLeft", { disconnected: true });
      }
      function handleConnectionLoggedIn() {
          _connectionOn = true;
          if (tryReconnecting) {
              logger.debug("connection is now up - trying to reconnect...");
              join(_latestOptions);
          }
      }
      function onJoined(callback) {
          if (isJoined) {
              callback(false);
          }
          return callbacks.add("onJoined", callback);
      }
      function onLeft(callback) {
          if (!isJoined) {
              callback();
          }
          return callbacks.add("onLeft", callback);
      }
      function handleErrorMessage(msg) {
          if (domain !== msg.domain) {
              return;
          }
          const requestId = msg.request_id;
          if (!requestId) {
              return;
          }
          const entry = requestsMap[requestId];
          if (!entry) {
              return;
          }
          entry.error(msg);
      }
      function handleSuccessMessage(msg) {
          if (msg.domain !== domain) {
              return;
          }
          const requestId = msg.request_id;
          if (!requestId) {
              return;
          }
          const entry = requestsMap[requestId];
          if (!entry) {
              return;
          }
          entry.success(msg);
      }
      function getNextRequestId() {
          return nanoid$1(10);
      }
      let queuedCalls = [];
      function send(msg, tag, options) {
          const ignore = ["hello", "join"];
          if (msg.type && ignore.indexOf(msg.type) === -1) {
              if (!isJoined) {
                  console.warn(`trying to send a message (${msg.domain} ${msg.type}) but not connected, will queue`);
                  const pw = new PromiseWrapper$1();
                  queuedCalls.push({ msg, tag, options, pw });
                  if (queuedCalls.length === 1) {
                      const unsubscribe = onJoined(() => {
                          logger.info(`joined - will now send queued messages (${queuedCalls.length} -> [${queuedCalls.map((m) => m.msg.type)}])`);
                          queuedCalls.forEach((qm) => {
                              send(qm.msg, qm.tag, qm.options)
                                  .then((t) => qm.pw.resolve(t))
                                  .catch((e) => qm.pw.reject(e));
                          });
                          queuedCalls = [];
                          unsubscribe();
                      });
                  }
                  return pw.promise;
              }
          }
          options = options ?? {};
          msg.request_id = msg.request_id ?? getNextRequestId();
          msg.domain = msg.domain ?? domain;
          if (!options.skipPeerId) {
              msg.peer_id = connection.peerId;
          }
          const requestId = msg.request_id;
          return new Promise((resolve, reject) => {
              requestsMap[requestId] = {
                  success: (successMsg) => {
                      delete requestsMap[requestId];
                      successMsg._tag = tag;
                      resolve(successMsg);
                  },
                  error: (errorMsg) => {
                      logger.warn(`Gateway error - ${JSON.stringify(errorMsg)}`);
                      delete requestsMap[requestId];
                      errorMsg._tag = tag;
                      reject(errorMsg);
                  },
              };
              connection
                  .send(msg, options)
                  .catch((err) => {
                  requestsMap[requestId].error({ err });
              });
          });
      }
      function sendFireAndForget(msg) {
          msg.request_id = msg.request_id ? msg.request_id : getNextRequestId();
          msg.domain = msg.domain ?? domain;
          msg.peer_id = connection.peerId;
          return connection.send(msg);
      }
      return {
          join,
          leave,
          onJoined,
          onLeft,
          send,
          sendFireAndForget,
          on: (type, callback) => {
              connection.on(type, (msg) => {
                  if (msg.domain !== domain) {
                      return;
                  }
                  try {
                      callback(msg);
                  }
                  catch (e) {
                      logger.error(`Callback  failed: ${e} \n ${e.stack} \n msg was: ${JSON.stringify(msg)}`, e);
                  }
              });
          },
          loggedIn: (callback) => connection.loggedIn(callback),
          connected: (callback) => connection.connected(callback),
          disconnected: (callback) => connection.disconnected(callback),
          get peerId() {
              return connection.peerId;
          },
          get domain() {
              return domain;
          },
      };
  }

  class Connection {
      settings;
      logger;
      protocolVersion = 3;
      peerId;
      token;
      info;
      resolvedIdentity;
      availableDomains;
      gatewayToken;
      replayer;
      messageHandlers = {};
      ids = 1;
      registry = CallbackRegistryFactory$1();
      _connected = false;
      isTrace = false;
      transport;
      _defaultTransport;
      _defaultAuth;
      _targetTransport;
      _targetAuth;
      _swapTransport = false;
      _switchInProgress = false;
      _transportSubscriptions = [];
      datePrefix = "#T42_DATE#";
      datePrefixLen = this.datePrefix.length;
      dateMinLen = this.datePrefixLen + 1;
      datePrefixFirstChar = this.datePrefix[0];
      _sequelizer = new AsyncSequelizer();
      _isLoggedIn = false;
      shouldTryLogin = true;
      pingTimer;
      sessions = [];
      globalDomain;
      initialLogin = true;
      initialLoginAttempts = 3;
      loginConfig;
      constructor(settings, logger) {
          this.settings = settings;
          this.logger = logger;
          settings = settings || {};
          settings.reconnectAttempts = settings.reconnectAttempts ?? 10;
          settings.reconnectInterval = settings.reconnectInterval ?? 1000;
          if (settings.inproc) {
              this.transport = new InProcTransport(settings.inproc, logger.subLogger("inMemory"));
          }
          else if (settings.sharedWorker) {
              this.transport = new SharedWorkerTransport(settings.sharedWorker, logger.subLogger("shared-worker"));
          }
          else if (settings.webPlatform) {
              this.transport = new WebPlatformTransport(settings.webPlatform, logger.subLogger("web-platform"), settings.identity);
          }
          else if (settings.ws !== undefined) {
              this.transport = new WS(settings, logger.subLogger("ws"));
          }
          else {
              throw new Error("No connection information specified");
          }
          this.isTrace = logger.canPublish("trace");
          logger.debug(`starting with ${this.transport.name()} transport`);
          const unsubConnectionChanged = this.transport.onConnectedChanged(this.handleConnectionChanged.bind(this));
          const unsubOnMessage = this.transport.onMessage(this.handleTransportMessage.bind(this));
          this._transportSubscriptions.push(unsubConnectionChanged);
          this._transportSubscriptions.push(unsubOnMessage);
          this._defaultTransport = this.transport;
          this.ping();
      }
      async switchTransport(settings) {
          return this._sequelizer.enqueue(async () => {
              if (!settings || typeof settings !== "object") {
                  throw new Error("Cannot switch transports, because the settings are missing or invalid.");
              }
              if (typeof settings.type === "undefined") {
                  throw new Error("Cannot switch the transport, because the type is not defined");
              }
              this.logger.trace(`Starting transport switch with settings: ${JSON.stringify(settings)}`);
              const switchTargetTransport = settings.type === "secondary" ? this.getNewSecondaryTransport(settings) : this._defaultTransport;
              this._targetTransport = switchTargetTransport;
              this._targetAuth = settings.type === "secondary" ? this.getNewSecondaryAuth(settings) : this._defaultAuth;
              const verifyPromise = this.verifyConnection();
              this._swapTransport = true;
              this._switchInProgress = true;
              this.logger.trace("The new transport has been set, closing the current transport");
              await this.transport.close();
              try {
                  await verifyPromise;
                  const isSwitchSuccess = this.transport === switchTargetTransport;
                  this.logger.info(`The reconnection after the switch was completed. Was the switch a success: ${isSwitchSuccess}`);
                  this._switchInProgress = false;
                  return { success: isSwitchSuccess };
              }
              catch (error) {
                  this.logger.info("The reconnection after the switch timed out, reverting back to the default transport.");
                  this.switchTransport({ type: "default" });
                  this._switchInProgress = false;
                  return { success: false };
              }
          });
      }
      onLibReAnnounced(callback) {
          return this.registry.add("libReAnnounced", callback);
      }
      setLibReAnnounced(lib) {
          this.registry.execute("libReAnnounced", lib);
      }
      send(message, options) {
          if (this.transport.sendObject &&
              this.transport.isObjectBasedTransport) {
              const msg = this.createObjectMessage(message);
              if (this.isTrace) {
                  this.logger.trace(`>> ${JSON.stringify(msg)}`);
              }
              return this.transport.sendObject(msg, options);
          }
          else {
              const strMessage = this.createStringMessage(message);
              if (this.isTrace) {
                  this.logger.trace(`>> ${strMessage}`);
              }
              return this.transport.send(strMessage, options);
          }
      }
      on(type, messageHandler) {
          type = type.toLowerCase();
          if (this.messageHandlers[type] === undefined) {
              this.messageHandlers[type] = {};
          }
          const id = this.ids++;
          this.messageHandlers[type][id] = messageHandler;
          return {
              type,
              id,
          };
      }
      off(info) {
          delete this.messageHandlers[info.type.toLowerCase()][info.id];
      }
      get isConnected() {
          return this._isLoggedIn;
      }
      connected(callback) {
          return this.loggedIn(() => {
              const currentServer = this.transport.name();
              callback(currentServer);
          });
      }
      disconnected(callback) {
          return this.registry.add("disconnected", callback);
      }
      async login(authRequest, reconnect) {
          if (!this._defaultAuth) {
              this._defaultAuth = authRequest;
          }
          if (this._swapTransport) {
              this.logger.trace("Detected a transport swap, swapping transports");
              const newAuth = this.transportSwap();
              authRequest = newAuth ?? authRequest;
          }
          this.logger.trace(`Starting login for transport: ${this.transport.name()} and auth ${JSON.stringify(authRequest)}`);
          try {
              await this.transport.open();
              this.logger.trace(`Transport: ${this.transport.name()} opened, logging in`);
              timer("connection").mark("transport-opened");
              const identity = await this.loginCore(authRequest, reconnect);
              this.logger.trace(`Logged in with identity: ${JSON.stringify(identity)}`);
              timer("connection").mark("protocol-logged-in");
              return identity;
          }
          catch (error) {
              if (this._switchInProgress) {
                  this.logger.trace("An error while logging in after a transport swap, preparing a default swap.");
                  this.prepareDefaultSwap();
              }
              throw new Error(error);
          }
      }
      async logout() {
          await this.logoutCore();
          await this.transport.close();
      }
      loggedIn(callback) {
          if (this._isLoggedIn) {
              callback();
          }
          return this.registry.add("onLoggedIn", callback);
      }
      domain(domain, successMessages, errorMessages) {
          let session = this.sessions.find((s) => s.domain === domain);
          if (!session) {
              session = domainSession(domain, this, this.logger.subLogger(`domain=${domain}`), successMessages, errorMessages);
              this.sessions.push(session);
          }
          return session;
      }
      authToken() {
          const createTokenReq = {
              domain: "global",
              type: "create-token"
          };
          if (!this.globalDomain) {
              return Promise.reject(new Error("no global domain session"));
          }
          return this.globalDomain.send(createTokenReq)
              .then((res) => {
              return res.token;
          });
      }
      reconnect() {
          return this.transport.reconnect();
      }
      setLoggedIn(value) {
          this._isLoggedIn = value;
          if (this._isLoggedIn) {
              this.registry.execute("onLoggedIn");
          }
      }
      distributeMessage(message, type) {
          const handlers = this.messageHandlers[type.toLowerCase()];
          if (handlers !== undefined) {
              Object.keys(handlers).forEach((handlerId) => {
                  const handler = handlers[handlerId];
                  if (handler !== undefined) {
                      try {
                          handler(message);
                      }
                      catch (error) {
                          try {
                              this.logger.error(`Message handler failed with ${error.stack}`, error);
                          }
                          catch (loggerError) {
                              console.log("Message handler failed", error);
                          }
                      }
                  }
              });
          }
      }
      handleConnectionChanged(connected) {
          if (this._connected === connected) {
              return;
          }
          this._connected = connected;
          if (connected) {
              if (this.settings?.replaySpecs?.length) {
                  this.replayer = new MessageReplayerImpl(this.settings.replaySpecs);
                  this.replayer.init(this);
              }
              this.registry.execute("connected");
          }
          else {
              this.handleDisconnected();
              this.registry.execute("disconnected");
          }
      }
      handleDisconnected() {
          this.setLoggedIn(false);
          const tryToLogin = this.shouldTryLogin;
          if (tryToLogin && this.initialLogin) {
              if (this.initialLoginAttempts <= 0) {
                  return;
              }
              this.initialLoginAttempts--;
          }
          this.logger.debug("disconnected - will try new login?" + this.shouldTryLogin);
          if (this.shouldTryLogin) {
              if (!this.loginConfig) {
                  throw new Error("no login info");
              }
              this.login(this.loginConfig, true)
                  .catch(() => {
                  setTimeout(this.handleDisconnected.bind(this), this.settings.reconnectInterval || 1000);
              });
          }
      }
      handleTransportMessage(msg) {
          let msgObj;
          if (typeof msg === "string") {
              msgObj = this.processStringMessage(msg);
          }
          else {
              msgObj = this.processObjectMessage(msg);
          }
          if (this.isTrace) {
              this.logger.trace(`<< ${JSON.stringify(msgObj)}`);
          }
          this.distributeMessage(msgObj.msg, msgObj.msgType);
      }
      verifyConnection() {
          return PromisePlus$1((resolve) => {
              let unsub;
              const ready = waitForInvocations(2, () => {
                  if (unsub) {
                      unsub();
                  }
                  resolve();
              });
              unsub = this.onLibReAnnounced((lib) => {
                  if (lib.name === "interop") {
                      return ready();
                  }
                  if (lib.name === "contexts") {
                      return ready();
                  }
              });
          }, 10000, "Transport switch timed out waiting for all libraries to be re-announced");
      }
      getNewSecondaryTransport(settings) {
          if (!settings.transportConfig?.url) {
              throw new Error("Missing secondary transport URL.");
          }
          return new WS(Object.assign({}, this.settings, { ws: settings.transportConfig.url, reconnectAttempts: 1 }), this.logger.subLogger("ws-secondary"));
      }
      getNewSecondaryAuth(settings) {
          if (!settings.transportConfig?.auth) {
              throw new Error("Missing secondary transport auth information.");
          }
          return settings.transportConfig.auth;
      }
      transportSwap() {
          this._swapTransport = false;
          if (!this._targetTransport || !this._targetAuth) {
              this.logger.warn(`Error while switching transports - either the target transport or auth is not defined: transport defined -> ${!!this._defaultTransport}, auth defined -> ${!!this._targetAuth}. Staying on the current one.`);
              return;
          }
          this._transportSubscriptions.forEach((unsub) => unsub());
          this._transportSubscriptions = [];
          this.transport = this._targetTransport;
          const unsubConnectionChanged = this.transport.onConnectedChanged(this.handleConnectionChanged.bind(this));
          const unsubOnMessage = this.transport.onMessage(this.handleTransportMessage.bind(this));
          this._transportSubscriptions.push(unsubConnectionChanged);
          this._transportSubscriptions.push(unsubOnMessage);
          return this._targetAuth;
      }
      prepareDefaultSwap() {
          this._transportSubscriptions.forEach((unsub) => unsub());
          this._transportSubscriptions = [];
          this.transport.close().catch((error) => this.logger.warn(`Error closing the ${this.transport.name()} transport after a failed connection attempt: ${JSON.stringify(error)}`));
          this._targetTransport = this._defaultTransport;
          this._targetAuth = this._defaultAuth;
          this._swapTransport = true;
      }
      processStringMessage(message) {
          const msg = JSON.parse(message, (key, value) => {
              if (typeof value !== "string") {
                  return value;
              }
              if (value.length < this.dateMinLen) {
                  return value;
              }
              if (!value.startsWith(this.datePrefixFirstChar)) {
                  return value;
              }
              if (value.substring(0, this.datePrefixLen) !== this.datePrefix) {
                  return value;
              }
              try {
                  const milliseconds = parseInt(value.substring(this.datePrefixLen, value.length), 10);
                  if (isNaN(milliseconds)) {
                      return value;
                  }
                  return new Date(milliseconds);
              }
              catch (ex) {
                  return value;
              }
          });
          return {
              msg,
              msgType: msg.type,
          };
      }
      createStringMessage(message) {
          const oldToJson = Date.prototype.toJSON;
          try {
              const datePrefix = this.datePrefix;
              Date.prototype.toJSON = function () {
                  return datePrefix + this.getTime();
              };
              const result = JSON.stringify(message);
              return result;
          }
          finally {
              Date.prototype.toJSON = oldToJson;
          }
      }
      processObjectMessage(message) {
          if (!message.type) {
              throw new Error("Object should have type property");
          }
          return {
              msg: message,
              msgType: message.type,
          };
      }
      createObjectMessage(message) {
          return message;
      }
      async loginCore(config, reconnect) {
          this.logger.info("logging in...");
          this.loginConfig = config;
          if (!this.loginConfig) {
              this.loginConfig = { username: "", password: "" };
          }
          this.shouldTryLogin = true;
          const authentication = await this.setupAuthConfig(config, reconnect);
          const helloMsg = {
              type: "hello",
              identity: this.settings.identity,
              authentication
          };
          if (config.sessionId) {
              helloMsg.request_id = config.sessionId;
          }
          this.globalDomain = domainSession("global", this, this.logger.subLogger("global-domain"), [
              "welcome",
              "token",
              "authentication-request"
          ]);
          const sendOptions = { skipPeerId: true };
          if (this.initialLogin) {
              sendOptions.retryInterval = this.settings.reconnectInterval;
              sendOptions.maxRetries = this.settings.reconnectAttempts;
          }
          try {
              const welcomeMsg = await this.tryAuthenticate(this.globalDomain, helloMsg, sendOptions, config);
              this.initialLogin = false;
              this.logger.info("login successful with peerId " + welcomeMsg.peer_id);
              this.peerId = welcomeMsg.peer_id;
              this.resolvedIdentity = welcomeMsg.resolved_identity;
              this.availableDomains = welcomeMsg.available_domains;
              if (welcomeMsg.options) {
                  this.token = welcomeMsg.options.access_token;
                  this.info = welcomeMsg.options.info;
              }
              this.setLoggedIn(true);
              return welcomeMsg.resolved_identity;
          }
          catch (err) {
              this.logger.error("error sending hello message - " + (err.message || err.msg || err.reason || err), err);
              throw err;
          }
          finally {
              if (config?.flowCallback && config.sessionId) {
                  config.flowCallback(config.sessionId, null);
              }
          }
      }
      async tryAuthenticate(globalDomain, helloMsg, sendOptions, config) {
          let welcomeMsg;
          while (true) {
              const msg = await globalDomain.send(helloMsg, undefined, sendOptions);
              if (msg.type === "authentication-request") {
                  const token = Buffer.from(msg.authentication.token, "base64");
                  if (config.flowCallback && config.sessionId) {
                      helloMsg.authentication.token =
                          (await config.flowCallback(config.sessionId, token))
                              .data
                              .toString("base64");
                  }
                  helloMsg.request_id = config.sessionId;
              }
              else if (msg.type === "welcome") {
                  welcomeMsg = msg;
                  break;
              }
              else if (msg.type === "error") {
                  throw new Error("Authentication failed: " + msg.reason);
              }
              else {
                  throw new Error("Unexpected message type during authentication: " + msg.type);
              }
          }
          return welcomeMsg;
      }
      async setupAuthConfig(config, reconnect) {
          const authentication = {};
          this.gatewayToken = config.gatewayToken;
          if (config.gatewayToken) {
              if (reconnect) {
                  try {
                      config.gatewayToken = await this.getNewGWToken();
                  }
                  catch (e) {
                      this.logger.warn(`failed to get GW token when reconnecting ${e?.message || e}`);
                  }
              }
              authentication.method = "gateway-token";
              authentication.token = config.gatewayToken;
              this.gatewayToken = config.gatewayToken;
          }
          else if (config.flowName === "sspi") {
              authentication.provider = "win";
              authentication.method = "access-token";
              if (config.flowCallback && config.sessionId) {
                  authentication.token =
                      (await config.flowCallback(config.sessionId, null))
                          .data
                          .toString("base64");
              }
              else {
                  throw new Error("Invalid SSPI config");
              }
          }
          else if (config.token) {
              authentication.method = "access-token";
              authentication.token = config.token;
          }
          else if (config.username) {
              authentication.method = "secret";
              authentication.login = config.username;
              authentication.secret = config.password;
          }
          else if (config.provider) {
              authentication.provider = config.provider;
              authentication.providerContext = config.providerContext;
          }
          else {
              throw new Error("invalid auth message" + JSON.stringify(config));
          }
          return authentication;
      }
      async logoutCore() {
          this.logger.debug("logging out...");
          this.shouldTryLogin = false;
          if (this.pingTimer) {
              clearTimeout(this.pingTimer);
          }
          const promises = this.sessions.map((session) => {
              session.leave();
          });
          await Promise.all(promises);
      }
      getNewGWToken() {
          if (typeof window !== "undefined") {
              const glue42gd = window.glue42gd;
              if (glue42gd) {
                  return glue42gd.getGWToken();
              }
          }
          return Promise.reject(new Error("not running in GD"));
      }
      ping() {
          if (!this.shouldTryLogin) {
              return;
          }
          if (this._isLoggedIn) {
              this.send({ type: "ping" });
          }
          this.pingTimer = setTimeout(() => {
              this.ping();
          }, 30 * 1000);
      }
  }

  const order = ["trace", "debug", "info", "warn", "error", "off"];
  let Logger$1 = class Logger {
      name;
      parent;
      static Interop;
      static InteropMethodName = "T42.AppLogger.Log";
      static Instance;
      path;
      subLoggers = [];
      _consoleLevel;
      _publishLevel;
      loggerFullName;
      includeTimeAndLevel;
      logFn = console;
      customLogFn = false;
      constructor(name, parent, logFn) {
          this.name = name;
          this.parent = parent;
          this.name = name;
          if (parent) {
              this.path = `${parent.path}.${name}`;
          }
          else {
              this.path = name;
          }
          this.loggerFullName = `[${this.path}]`;
          this.includeTimeAndLevel = !logFn;
          if (logFn) {
              this.logFn = logFn;
              this.customLogFn = true;
          }
      }
      subLogger(name) {
          const existingSub = this.subLoggers.filter((subLogger) => {
              return subLogger.name === name;
          })[0];
          if (existingSub !== undefined) {
              return existingSub;
          }
          Object.keys(this).forEach((key) => {
              if (key === name) {
                  throw new Error("This sub logger name is not allowed.");
              }
          });
          const sub = new Logger(name, this, this.customLogFn ? this.logFn : undefined);
          this.subLoggers.push(sub);
          return sub;
      }
      publishLevel(level) {
          if (level) {
              this._publishLevel = level;
          }
          return this._publishLevel || this.parent?.publishLevel();
      }
      consoleLevel(level) {
          if (level) {
              this._consoleLevel = level;
          }
          return this._consoleLevel || this.parent?.consoleLevel();
      }
      log(message, level, error) {
          this.publishMessage(level || "info", message, error);
      }
      trace(message) {
          this.log(message, "trace");
      }
      debug(message) {
          this.log(message, "debug");
      }
      info(message) {
          this.log(message, "info");
      }
      warn(message) {
          this.log(message, "warn");
      }
      error(message, err) {
          this.log(message, "error", err);
      }
      canPublish(level, compareWith) {
          const levelIdx = order.indexOf(level);
          const restrictionIdx = order.indexOf(compareWith || this.consoleLevel() || "trace");
          return levelIdx >= restrictionIdx;
      }
      publishMessage(level, message, error) {
          const loggerName = this.loggerFullName;
          if (level === "error" && !error) {
              const e = new Error();
              if (e.stack) {
                  message =
                      message +
                          "\n" +
                          e.stack
                              .split("\n")
                              .slice(4)
                              .join("\n");
              }
          }
          if (this.canPublish(level, this.publishLevel())) {
              const interop = Logger.Interop;
              if (interop) {
                  try {
                      if (interop.methods({ name: Logger.InteropMethodName }).length > 0) {
                          const args = {
                              msg: message,
                              logger: loggerName,
                              level
                          };
                          if (error && error instanceof Error) {
                              args.error = {
                                  message: error.message,
                                  stack: error.stack ?? ""
                              };
                          }
                          interop.invoke(Logger.InteropMethodName, args);
                      }
                  }
                  catch {
                  }
              }
          }
          if (this.canPublish(level)) {
              let prefix = "";
              if (this.includeTimeAndLevel) {
                  const date = new Date();
                  const time = `${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}:${date.getMilliseconds()}`;
                  prefix = `[${time}] [${level}] `;
              }
              const toPrint = `${prefix}${loggerName}: ${message}`;
              switch (level) {
                  case "trace":
                      this.logFn.debug(toPrint);
                      break;
                  case "debug":
                      if (this.logFn.debug) {
                          this.logFn.debug(toPrint);
                      }
                      else {
                          this.logFn.log(toPrint);
                      }
                      break;
                  case "info":
                      this.logFn.info(toPrint);
                      break;
                  case "warn":
                      this.logFn.warn(toPrint);
                      break;
                  case "error":
                      this.logFn.error(toPrint, error);
                      break;
              }
          }
      }
  };

  const GW_MESSAGE_CREATE_CONTEXT = "create-context";
  const GW_MESSAGE_ACTIVITY_CREATED = "created";
  const GW_MESSAGE_ACTIVITY_DESTROYED = "destroyed";
  const GW_MESSAGE_CONTEXT_CREATED = "context-created";
  const GW_MESSAGE_CONTEXT_ADDED = "context-added";
  const GW_MESSAGE_SUBSCRIBE_CONTEXT = "subscribe-context";
  const GW_MESSAGE_SUBSCRIBED_CONTEXT = "subscribed-context";
  const GW_MESSAGE_UNSUBSCRIBE_CONTEXT = "unsubscribe-context";
  const GW_MESSAGE_DESTROY_CONTEXT = "destroy-context";
  const GW_MESSAGE_CONTEXT_DESTROYED = "context-destroyed";
  const GW_MESSAGE_UPDATE_CONTEXT = "update-context";
  const GW_MESSAGE_CONTEXT_UPDATED = "context-updated";
  const GW_MESSAGE_JOINED_ACTIVITY = "joined";

  const ContextMessageReplaySpec = {
      get name() {
          return "context";
      },
      get types() {
          return [
              GW_MESSAGE_CREATE_CONTEXT,
              GW_MESSAGE_ACTIVITY_CREATED,
              GW_MESSAGE_ACTIVITY_DESTROYED,
              GW_MESSAGE_CONTEXT_CREATED,
              GW_MESSAGE_CONTEXT_ADDED,
              GW_MESSAGE_SUBSCRIBE_CONTEXT,
              GW_MESSAGE_SUBSCRIBED_CONTEXT,
              GW_MESSAGE_UNSUBSCRIBE_CONTEXT,
              GW_MESSAGE_DESTROY_CONTEXT,
              GW_MESSAGE_CONTEXT_DESTROYED,
              GW_MESSAGE_UPDATE_CONTEXT,
              GW_MESSAGE_CONTEXT_UPDATED,
              GW_MESSAGE_JOINED_ACTIVITY
          ];
      }
  };

  var version$1 = "6.5.2-fmr-beta";

  function prepareConfig$1 (configuration, ext, glue42gd) {
      let nodeStartingContext;
      if (Utils$1.isNode()) {
          const startingContextString = process.env._GD_STARTING_CONTEXT_;
          if (startingContextString) {
              try {
                  nodeStartingContext = JSON.parse(startingContextString);
              }
              catch {
              }
          }
      }
      function getConnection() {
          const gwConfig = configuration.gateway;
          const protocolVersion = gwConfig?.protocolVersion ?? 3;
          const reconnectInterval = gwConfig?.reconnectInterval;
          const reconnectAttempts = gwConfig?.reconnectAttempts;
          const defaultWs = "ws://localhost:8385";
          let ws = gwConfig?.ws;
          const sharedWorker = gwConfig?.sharedWorker;
          const inproc = gwConfig?.inproc;
          const webPlatform = gwConfig?.webPlatform ?? undefined;
          if (glue42gd) {
              ws = glue42gd.gwURL;
          }
          if (Utils$1.isNode() && nodeStartingContext && nodeStartingContext.gwURL) {
              ws = nodeStartingContext.gwURL;
          }
          if (!ws && !sharedWorker && !inproc) {
              ws = defaultWs;
          }
          let instanceId;
          let windowId;
          let pid;
          let environment;
          let region;
          const appName = getApplication();
          let uniqueAppName = appName;
          if (typeof glue42gd !== "undefined") {
              windowId = glue42gd.windowId;
              pid = glue42gd.pid;
              if (glue42gd.env) {
                  environment = glue42gd.env.env;
                  region = glue42gd.env.region;
              }
              uniqueAppName = glue42gd.application ?? "glue-app";
              instanceId = glue42gd.appInstanceId;
          }
          else if (Utils$1.isNode()) {
              pid = process.pid;
              if (nodeStartingContext) {
                  environment = nodeStartingContext.env;
                  region = nodeStartingContext.region;
                  instanceId = nodeStartingContext.instanceId;
              }
          }
          else if (typeof window?.glue42electron !== "undefined") {
              windowId = window?.glue42electron.instanceId;
              pid = window?.glue42electron.pid;
              environment = window?.glue42electron.env;
              region = window?.glue42electron.region;
              uniqueAppName = window?.glue42electron.application ?? "glue-app";
              instanceId = window?.glue42electron.instanceId;
          }
          else ;
          const replaySpecs = configuration.gateway?.replaySpecs ?? [];
          replaySpecs.push(ContextMessageReplaySpec);
          let identity = {
              application: uniqueAppName,
              applicationName: appName,
              windowId,
              instance: instanceId,
              process: pid,
              region,
              environment,
              api: ext.version || version$1
          };
          if (configuration.identity) {
              identity = Object.assign(identity, configuration.identity);
          }
          return {
              identity,
              reconnectInterval,
              ws,
              sharedWorker,
              webPlatform,
              inproc,
              protocolVersion,
              reconnectAttempts,
              replaySpecs,
          };
      }
      function getContexts() {
          if (typeof configuration.contexts === "undefined") {
              return { reAnnounceKnownContexts: true };
          }
          if (typeof configuration.contexts === "boolean" && configuration.contexts) {
              return { reAnnounceKnownContexts: true };
          }
          if (typeof configuration.contexts === "object") {
              return Object.assign({}, { reAnnounceKnownContexts: true }, configuration.contexts);
          }
          return false;
      }
      function getApplication() {
          if (configuration.application) {
              return configuration.application;
          }
          if (glue42gd) {
              return glue42gd.applicationName;
          }
          if (typeof window !== "undefined" && typeof window.glue42electron !== "undefined") {
              return window.glue42electron.application;
          }
          const uid = nanoid$1(10);
          if (Utils$1.isNode()) {
              if (nodeStartingContext) {
                  return nodeStartingContext.applicationConfig.name;
              }
              return "NodeJS" + uid;
          }
          if (typeof window !== "undefined" && typeof document !== "undefined") {
              return document.title + ` (${uid})`;
          }
          return uid;
      }
      function getAuth() {
          if (typeof configuration.auth === "string") {
              return {
                  token: configuration.auth
              };
          }
          if (configuration.auth) {
              return configuration.auth;
          }
          if (Utils$1.isNode() && nodeStartingContext && nodeStartingContext.gwToken) {
              return {
                  gatewayToken: nodeStartingContext.gwToken
              };
          }
          if (configuration.gateway?.webPlatform || configuration.gateway?.inproc || configuration.gateway?.sharedWorker) {
              return {
                  username: "glue42", password: "glue42"
              };
          }
      }
      function getLogger() {
          let config = configuration.logger;
          const defaultLevel = "warn";
          if (!config) {
              config = defaultLevel;
          }
          let gdConsoleLevel;
          if (glue42gd) {
              gdConsoleLevel = glue42gd.consoleLogLevel;
          }
          if (typeof config === "string") {
              return { console: gdConsoleLevel ?? config, publish: defaultLevel };
          }
          return {
              console: gdConsoleLevel ?? config.console ?? defaultLevel,
              publish: config.publish ?? defaultLevel
          };
      }
      const connection = getConnection();
      let application = getApplication();
      if (typeof window !== "undefined") {
          const windowAsAny = window;
          const containerApplication = windowAsAny.htmlContainer ?
              `${windowAsAny.htmlContainer.containerName}.${windowAsAny.htmlContainer.application}` :
              windowAsAny?.glue42gd?.application;
          if (containerApplication) {
              application = containerApplication;
          }
      }
      return {
          bus: configuration.bus ?? false,
          application,
          auth: getAuth(),
          logger: getLogger(),
          connection,
          metrics: configuration.metrics ?? true,
          contexts: getContexts(),
          version: ext.version || version$1,
          libs: ext.libs ?? [],
          customLogger: configuration.customLogger
      };
  }

  class GW3ContextData {
      name;
      contextId;
      context;
      isAnnounced;
      joinedActivity;
      updateCallbacks = {};
      activityId;
      sentExplicitSubscription;
      hasReceivedSnapshot;
      constructor(contextId, name, isAnnounced, activityId) {
          this.contextId = contextId;
          this.name = name;
          this.isAnnounced = isAnnounced;
          this.activityId = activityId;
          this.context = {};
      }
      hasCallbacks() {
          return Object.keys(this.updateCallbacks).length > 0;
      }
      getState() {
          if (this.isAnnounced && this.hasCallbacks()) {
              return 3;
          }
          if (this.isAnnounced) {
              return 2;
          }
          if (this.hasCallbacks()) {
              return 1;
          }
          return 0;
      }
  }

  var lodash_clonedeep = {exports: {}};

  /**
   * lodash (Custom Build) <https://lodash.com/>
   * Build: `lodash modularize exports="npm" -o ./`
   * Copyright jQuery Foundation and other contributors <https://jquery.org/>
   * Released under MIT license <https://lodash.com/license>
   * Based on Underscore.js 1.8.3 <http://underscorejs.org/LICENSE>
   * Copyright Jeremy Ashkenas, DocumentCloud and Investigative Reporters & Editors
   */
  lodash_clonedeep.exports;

  (function (module, exports) {
  	/** Used as the size to enable large array optimizations. */
  	var LARGE_ARRAY_SIZE = 200;

  	/** Used to stand-in for `undefined` hash values. */
  	var HASH_UNDEFINED = '__lodash_hash_undefined__';

  	/** Used as references for various `Number` constants. */
  	var MAX_SAFE_INTEGER = 9007199254740991;

  	/** `Object#toString` result references. */
  	var argsTag = '[object Arguments]',
  	    arrayTag = '[object Array]',
  	    boolTag = '[object Boolean]',
  	    dateTag = '[object Date]',
  	    errorTag = '[object Error]',
  	    funcTag = '[object Function]',
  	    genTag = '[object GeneratorFunction]',
  	    mapTag = '[object Map]',
  	    numberTag = '[object Number]',
  	    objectTag = '[object Object]',
  	    promiseTag = '[object Promise]',
  	    regexpTag = '[object RegExp]',
  	    setTag = '[object Set]',
  	    stringTag = '[object String]',
  	    symbolTag = '[object Symbol]',
  	    weakMapTag = '[object WeakMap]';

  	var arrayBufferTag = '[object ArrayBuffer]',
  	    dataViewTag = '[object DataView]',
  	    float32Tag = '[object Float32Array]',
  	    float64Tag = '[object Float64Array]',
  	    int8Tag = '[object Int8Array]',
  	    int16Tag = '[object Int16Array]',
  	    int32Tag = '[object Int32Array]',
  	    uint8Tag = '[object Uint8Array]',
  	    uint8ClampedTag = '[object Uint8ClampedArray]',
  	    uint16Tag = '[object Uint16Array]',
  	    uint32Tag = '[object Uint32Array]';

  	/**
  	 * Used to match `RegExp`
  	 * [syntax characters](http://ecma-international.org/ecma-262/7.0/#sec-patterns).
  	 */
  	var reRegExpChar = /[\\^$.*+?()[\]{}|]/g;

  	/** Used to match `RegExp` flags from their coerced string values. */
  	var reFlags = /\w*$/;

  	/** Used to detect host constructors (Safari). */
  	var reIsHostCtor = /^\[object .+?Constructor\]$/;

  	/** Used to detect unsigned integer values. */
  	var reIsUint = /^(?:0|[1-9]\d*)$/;

  	/** Used to identify `toStringTag` values supported by `_.clone`. */
  	var cloneableTags = {};
  	cloneableTags[argsTag] = cloneableTags[arrayTag] =
  	cloneableTags[arrayBufferTag] = cloneableTags[dataViewTag] =
  	cloneableTags[boolTag] = cloneableTags[dateTag] =
  	cloneableTags[float32Tag] = cloneableTags[float64Tag] =
  	cloneableTags[int8Tag] = cloneableTags[int16Tag] =
  	cloneableTags[int32Tag] = cloneableTags[mapTag] =
  	cloneableTags[numberTag] = cloneableTags[objectTag] =
  	cloneableTags[regexpTag] = cloneableTags[setTag] =
  	cloneableTags[stringTag] = cloneableTags[symbolTag] =
  	cloneableTags[uint8Tag] = cloneableTags[uint8ClampedTag] =
  	cloneableTags[uint16Tag] = cloneableTags[uint32Tag] = true;
  	cloneableTags[errorTag] = cloneableTags[funcTag] =
  	cloneableTags[weakMapTag] = false;

  	/** Detect free variable `global` from Node.js. */
  	var freeGlobal = typeof commonjsGlobal$1 == 'object' && commonjsGlobal$1 && commonjsGlobal$1.Object === Object && commonjsGlobal$1;

  	/** Detect free variable `self`. */
  	var freeSelf = typeof self == 'object' && self && self.Object === Object && self;

  	/** Used as a reference to the global object. */
  	var root = freeGlobal || freeSelf || Function('return this')();

  	/** Detect free variable `exports`. */
  	var freeExports = exports && !exports.nodeType && exports;

  	/** Detect free variable `module`. */
  	var freeModule = freeExports && 'object' == 'object' && module && !module.nodeType && module;

  	/** Detect the popular CommonJS extension `module.exports`. */
  	var moduleExports = freeModule && freeModule.exports === freeExports;

  	/**
  	 * Adds the key-value `pair` to `map`.
  	 *
  	 * @private
  	 * @param {Object} map The map to modify.
  	 * @param {Array} pair The key-value pair to add.
  	 * @returns {Object} Returns `map`.
  	 */
  	function addMapEntry(map, pair) {
  	  // Don't return `map.set` because it's not chainable in IE 11.
  	  map.set(pair[0], pair[1]);
  	  return map;
  	}

  	/**
  	 * Adds `value` to `set`.
  	 *
  	 * @private
  	 * @param {Object} set The set to modify.
  	 * @param {*} value The value to add.
  	 * @returns {Object} Returns `set`.
  	 */
  	function addSetEntry(set, value) {
  	  // Don't return `set.add` because it's not chainable in IE 11.
  	  set.add(value);
  	  return set;
  	}

  	/**
  	 * A specialized version of `_.forEach` for arrays without support for
  	 * iteratee shorthands.
  	 *
  	 * @private
  	 * @param {Array} [array] The array to iterate over.
  	 * @param {Function} iteratee The function invoked per iteration.
  	 * @returns {Array} Returns `array`.
  	 */
  	function arrayEach(array, iteratee) {
  	  var index = -1,
  	      length = array ? array.length : 0;

  	  while (++index < length) {
  	    if (iteratee(array[index], index, array) === false) {
  	      break;
  	    }
  	  }
  	  return array;
  	}

  	/**
  	 * Appends the elements of `values` to `array`.
  	 *
  	 * @private
  	 * @param {Array} array The array to modify.
  	 * @param {Array} values The values to append.
  	 * @returns {Array} Returns `array`.
  	 */
  	function arrayPush(array, values) {
  	  var index = -1,
  	      length = values.length,
  	      offset = array.length;

  	  while (++index < length) {
  	    array[offset + index] = values[index];
  	  }
  	  return array;
  	}

  	/**
  	 * A specialized version of `_.reduce` for arrays without support for
  	 * iteratee shorthands.
  	 *
  	 * @private
  	 * @param {Array} [array] The array to iterate over.
  	 * @param {Function} iteratee The function invoked per iteration.
  	 * @param {*} [accumulator] The initial value.
  	 * @param {boolean} [initAccum] Specify using the first element of `array` as
  	 *  the initial value.
  	 * @returns {*} Returns the accumulated value.
  	 */
  	function arrayReduce(array, iteratee, accumulator, initAccum) {
  	  var index = -1,
  	      length = array ? array.length : 0;
  	  while (++index < length) {
  	    accumulator = iteratee(accumulator, array[index], index, array);
  	  }
  	  return accumulator;
  	}

  	/**
  	 * The base implementation of `_.times` without support for iteratee shorthands
  	 * or max array length checks.
  	 *
  	 * @private
  	 * @param {number} n The number of times to invoke `iteratee`.
  	 * @param {Function} iteratee The function invoked per iteration.
  	 * @returns {Array} Returns the array of results.
  	 */
  	function baseTimes(n, iteratee) {
  	  var index = -1,
  	      result = Array(n);

  	  while (++index < n) {
  	    result[index] = iteratee(index);
  	  }
  	  return result;
  	}

  	/**
  	 * Gets the value at `key` of `object`.
  	 *
  	 * @private
  	 * @param {Object} [object] The object to query.
  	 * @param {string} key The key of the property to get.
  	 * @returns {*} Returns the property value.
  	 */
  	function getValue(object, key) {
  	  return object == null ? undefined : object[key];
  	}

  	/**
  	 * Checks if `value` is a host object in IE < 9.
  	 *
  	 * @private
  	 * @param {*} value The value to check.
  	 * @returns {boolean} Returns `true` if `value` is a host object, else `false`.
  	 */
  	function isHostObject(value) {
  	  // Many host objects are `Object` objects that can coerce to strings
  	  // despite having improperly defined `toString` methods.
  	  var result = false;
  	  if (value != null && typeof value.toString != 'function') {
  	    try {
  	      result = !!(value + '');
  	    } catch (e) {}
  	  }
  	  return result;
  	}

  	/**
  	 * Converts `map` to its key-value pairs.
  	 *
  	 * @private
  	 * @param {Object} map The map to convert.
  	 * @returns {Array} Returns the key-value pairs.
  	 */
  	function mapToArray(map) {
  	  var index = -1,
  	      result = Array(map.size);

  	  map.forEach(function(value, key) {
  	    result[++index] = [key, value];
  	  });
  	  return result;
  	}

  	/**
  	 * Creates a unary function that invokes `func` with its argument transformed.
  	 *
  	 * @private
  	 * @param {Function} func The function to wrap.
  	 * @param {Function} transform The argument transform.
  	 * @returns {Function} Returns the new function.
  	 */
  	function overArg(func, transform) {
  	  return function(arg) {
  	    return func(transform(arg));
  	  };
  	}

  	/**
  	 * Converts `set` to an array of its values.
  	 *
  	 * @private
  	 * @param {Object} set The set to convert.
  	 * @returns {Array} Returns the values.
  	 */
  	function setToArray(set) {
  	  var index = -1,
  	      result = Array(set.size);

  	  set.forEach(function(value) {
  	    result[++index] = value;
  	  });
  	  return result;
  	}

  	/** Used for built-in method references. */
  	var arrayProto = Array.prototype,
  	    funcProto = Function.prototype,
  	    objectProto = Object.prototype;

  	/** Used to detect overreaching core-js shims. */
  	var coreJsData = root['__core-js_shared__'];

  	/** Used to detect methods masquerading as native. */
  	var maskSrcKey = (function() {
  	  var uid = /[^.]+$/.exec(coreJsData && coreJsData.keys && coreJsData.keys.IE_PROTO || '');
  	  return uid ? ('Symbol(src)_1.' + uid) : '';
  	}());

  	/** Used to resolve the decompiled source of functions. */
  	var funcToString = funcProto.toString;

  	/** Used to check objects for own properties. */
  	var hasOwnProperty = objectProto.hasOwnProperty;

  	/**
  	 * Used to resolve the
  	 * [`toStringTag`](http://ecma-international.org/ecma-262/7.0/#sec-object.prototype.tostring)
  	 * of values.
  	 */
  	var objectToString = objectProto.toString;

  	/** Used to detect if a method is native. */
  	var reIsNative = RegExp('^' +
  	  funcToString.call(hasOwnProperty).replace(reRegExpChar, '\\$&')
  	  .replace(/hasOwnProperty|(function).*?(?=\\\()| for .+?(?=\\\])/g, '$1.*?') + '$'
  	);

  	/** Built-in value references. */
  	var Buffer = moduleExports ? root.Buffer : undefined,
  	    Symbol = root.Symbol,
  	    Uint8Array = root.Uint8Array,
  	    getPrototype = overArg(Object.getPrototypeOf, Object),
  	    objectCreate = Object.create,
  	    propertyIsEnumerable = objectProto.propertyIsEnumerable,
  	    splice = arrayProto.splice;

  	/* Built-in method references for those with the same name as other `lodash` methods. */
  	var nativeGetSymbols = Object.getOwnPropertySymbols,
  	    nativeIsBuffer = Buffer ? Buffer.isBuffer : undefined,
  	    nativeKeys = overArg(Object.keys, Object);

  	/* Built-in method references that are verified to be native. */
  	var DataView = getNative(root, 'DataView'),
  	    Map = getNative(root, 'Map'),
  	    Promise = getNative(root, 'Promise'),
  	    Set = getNative(root, 'Set'),
  	    WeakMap = getNative(root, 'WeakMap'),
  	    nativeCreate = getNative(Object, 'create');

  	/** Used to detect maps, sets, and weakmaps. */
  	var dataViewCtorString = toSource(DataView),
  	    mapCtorString = toSource(Map),
  	    promiseCtorString = toSource(Promise),
  	    setCtorString = toSource(Set),
  	    weakMapCtorString = toSource(WeakMap);

  	/** Used to convert symbols to primitives and strings. */
  	var symbolProto = Symbol ? Symbol.prototype : undefined,
  	    symbolValueOf = symbolProto ? symbolProto.valueOf : undefined;

  	/**
  	 * Creates a hash object.
  	 *
  	 * @private
  	 * @constructor
  	 * @param {Array} [entries] The key-value pairs to cache.
  	 */
  	function Hash(entries) {
  	  var index = -1,
  	      length = entries ? entries.length : 0;

  	  this.clear();
  	  while (++index < length) {
  	    var entry = entries[index];
  	    this.set(entry[0], entry[1]);
  	  }
  	}

  	/**
  	 * Removes all key-value entries from the hash.
  	 *
  	 * @private
  	 * @name clear
  	 * @memberOf Hash
  	 */
  	function hashClear() {
  	  this.__data__ = nativeCreate ? nativeCreate(null) : {};
  	}

  	/**
  	 * Removes `key` and its value from the hash.
  	 *
  	 * @private
  	 * @name delete
  	 * @memberOf Hash
  	 * @param {Object} hash The hash to modify.
  	 * @param {string} key The key of the value to remove.
  	 * @returns {boolean} Returns `true` if the entry was removed, else `false`.
  	 */
  	function hashDelete(key) {
  	  return this.has(key) && delete this.__data__[key];
  	}

  	/**
  	 * Gets the hash value for `key`.
  	 *
  	 * @private
  	 * @name get
  	 * @memberOf Hash
  	 * @param {string} key The key of the value to get.
  	 * @returns {*} Returns the entry value.
  	 */
  	function hashGet(key) {
  	  var data = this.__data__;
  	  if (nativeCreate) {
  	    var result = data[key];
  	    return result === HASH_UNDEFINED ? undefined : result;
  	  }
  	  return hasOwnProperty.call(data, key) ? data[key] : undefined;
  	}

  	/**
  	 * Checks if a hash value for `key` exists.
  	 *
  	 * @private
  	 * @name has
  	 * @memberOf Hash
  	 * @param {string} key The key of the entry to check.
  	 * @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
  	 */
  	function hashHas(key) {
  	  var data = this.__data__;
  	  return nativeCreate ? data[key] !== undefined : hasOwnProperty.call(data, key);
  	}

  	/**
  	 * Sets the hash `key` to `value`.
  	 *
  	 * @private
  	 * @name set
  	 * @memberOf Hash
  	 * @param {string} key The key of the value to set.
  	 * @param {*} value The value to set.
  	 * @returns {Object} Returns the hash instance.
  	 */
  	function hashSet(key, value) {
  	  var data = this.__data__;
  	  data[key] = (nativeCreate && value === undefined) ? HASH_UNDEFINED : value;
  	  return this;
  	}

  	// Add methods to `Hash`.
  	Hash.prototype.clear = hashClear;
  	Hash.prototype['delete'] = hashDelete;
  	Hash.prototype.get = hashGet;
  	Hash.prototype.has = hashHas;
  	Hash.prototype.set = hashSet;

  	/**
  	 * Creates an list cache object.
  	 *
  	 * @private
  	 * @constructor
  	 * @param {Array} [entries] The key-value pairs to cache.
  	 */
  	function ListCache(entries) {
  	  var index = -1,
  	      length = entries ? entries.length : 0;

  	  this.clear();
  	  while (++index < length) {
  	    var entry = entries[index];
  	    this.set(entry[0], entry[1]);
  	  }
  	}

  	/**
  	 * Removes all key-value entries from the list cache.
  	 *
  	 * @private
  	 * @name clear
  	 * @memberOf ListCache
  	 */
  	function listCacheClear() {
  	  this.__data__ = [];
  	}

  	/**
  	 * Removes `key` and its value from the list cache.
  	 *
  	 * @private
  	 * @name delete
  	 * @memberOf ListCache
  	 * @param {string} key The key of the value to remove.
  	 * @returns {boolean} Returns `true` if the entry was removed, else `false`.
  	 */
  	function listCacheDelete(key) {
  	  var data = this.__data__,
  	      index = assocIndexOf(data, key);

  	  if (index < 0) {
  	    return false;
  	  }
  	  var lastIndex = data.length - 1;
  	  if (index == lastIndex) {
  	    data.pop();
  	  } else {
  	    splice.call(data, index, 1);
  	  }
  	  return true;
  	}

  	/**
  	 * Gets the list cache value for `key`.
  	 *
  	 * @private
  	 * @name get
  	 * @memberOf ListCache
  	 * @param {string} key The key of the value to get.
  	 * @returns {*} Returns the entry value.
  	 */
  	function listCacheGet(key) {
  	  var data = this.__data__,
  	      index = assocIndexOf(data, key);

  	  return index < 0 ? undefined : data[index][1];
  	}

  	/**
  	 * Checks if a list cache value for `key` exists.
  	 *
  	 * @private
  	 * @name has
  	 * @memberOf ListCache
  	 * @param {string} key The key of the entry to check.
  	 * @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
  	 */
  	function listCacheHas(key) {
  	  return assocIndexOf(this.__data__, key) > -1;
  	}

  	/**
  	 * Sets the list cache `key` to `value`.
  	 *
  	 * @private
  	 * @name set
  	 * @memberOf ListCache
  	 * @param {string} key The key of the value to set.
  	 * @param {*} value The value to set.
  	 * @returns {Object} Returns the list cache instance.
  	 */
  	function listCacheSet(key, value) {
  	  var data = this.__data__,
  	      index = assocIndexOf(data, key);

  	  if (index < 0) {
  	    data.push([key, value]);
  	  } else {
  	    data[index][1] = value;
  	  }
  	  return this;
  	}

  	// Add methods to `ListCache`.
  	ListCache.prototype.clear = listCacheClear;
  	ListCache.prototype['delete'] = listCacheDelete;
  	ListCache.prototype.get = listCacheGet;
  	ListCache.prototype.has = listCacheHas;
  	ListCache.prototype.set = listCacheSet;

  	/**
  	 * Creates a map cache object to store key-value pairs.
  	 *
  	 * @private
  	 * @constructor
  	 * @param {Array} [entries] The key-value pairs to cache.
  	 */
  	function MapCache(entries) {
  	  var index = -1,
  	      length = entries ? entries.length : 0;

  	  this.clear();
  	  while (++index < length) {
  	    var entry = entries[index];
  	    this.set(entry[0], entry[1]);
  	  }
  	}

  	/**
  	 * Removes all key-value entries from the map.
  	 *
  	 * @private
  	 * @name clear
  	 * @memberOf MapCache
  	 */
  	function mapCacheClear() {
  	  this.__data__ = {
  	    'hash': new Hash,
  	    'map': new (Map || ListCache),
  	    'string': new Hash
  	  };
  	}

  	/**
  	 * Removes `key` and its value from the map.
  	 *
  	 * @private
  	 * @name delete
  	 * @memberOf MapCache
  	 * @param {string} key The key of the value to remove.
  	 * @returns {boolean} Returns `true` if the entry was removed, else `false`.
  	 */
  	function mapCacheDelete(key) {
  	  return getMapData(this, key)['delete'](key);
  	}

  	/**
  	 * Gets the map value for `key`.
  	 *
  	 * @private
  	 * @name get
  	 * @memberOf MapCache
  	 * @param {string} key The key of the value to get.
  	 * @returns {*} Returns the entry value.
  	 */
  	function mapCacheGet(key) {
  	  return getMapData(this, key).get(key);
  	}

  	/**
  	 * Checks if a map value for `key` exists.
  	 *
  	 * @private
  	 * @name has
  	 * @memberOf MapCache
  	 * @param {string} key The key of the entry to check.
  	 * @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
  	 */
  	function mapCacheHas(key) {
  	  return getMapData(this, key).has(key);
  	}

  	/**
  	 * Sets the map `key` to `value`.
  	 *
  	 * @private
  	 * @name set
  	 * @memberOf MapCache
  	 * @param {string} key The key of the value to set.
  	 * @param {*} value The value to set.
  	 * @returns {Object} Returns the map cache instance.
  	 */
  	function mapCacheSet(key, value) {
  	  getMapData(this, key).set(key, value);
  	  return this;
  	}

  	// Add methods to `MapCache`.
  	MapCache.prototype.clear = mapCacheClear;
  	MapCache.prototype['delete'] = mapCacheDelete;
  	MapCache.prototype.get = mapCacheGet;
  	MapCache.prototype.has = mapCacheHas;
  	MapCache.prototype.set = mapCacheSet;

  	/**
  	 * Creates a stack cache object to store key-value pairs.
  	 *
  	 * @private
  	 * @constructor
  	 * @param {Array} [entries] The key-value pairs to cache.
  	 */
  	function Stack(entries) {
  	  this.__data__ = new ListCache(entries);
  	}

  	/**
  	 * Removes all key-value entries from the stack.
  	 *
  	 * @private
  	 * @name clear
  	 * @memberOf Stack
  	 */
  	function stackClear() {
  	  this.__data__ = new ListCache;
  	}

  	/**
  	 * Removes `key` and its value from the stack.
  	 *
  	 * @private
  	 * @name delete
  	 * @memberOf Stack
  	 * @param {string} key The key of the value to remove.
  	 * @returns {boolean} Returns `true` if the entry was removed, else `false`.
  	 */
  	function stackDelete(key) {
  	  return this.__data__['delete'](key);
  	}

  	/**
  	 * Gets the stack value for `key`.
  	 *
  	 * @private
  	 * @name get
  	 * @memberOf Stack
  	 * @param {string} key The key of the value to get.
  	 * @returns {*} Returns the entry value.
  	 */
  	function stackGet(key) {
  	  return this.__data__.get(key);
  	}

  	/**
  	 * Checks if a stack value for `key` exists.
  	 *
  	 * @private
  	 * @name has
  	 * @memberOf Stack
  	 * @param {string} key The key of the entry to check.
  	 * @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
  	 */
  	function stackHas(key) {
  	  return this.__data__.has(key);
  	}

  	/**
  	 * Sets the stack `key` to `value`.
  	 *
  	 * @private
  	 * @name set
  	 * @memberOf Stack
  	 * @param {string} key The key of the value to set.
  	 * @param {*} value The value to set.
  	 * @returns {Object} Returns the stack cache instance.
  	 */
  	function stackSet(key, value) {
  	  var cache = this.__data__;
  	  if (cache instanceof ListCache) {
  	    var pairs = cache.__data__;
  	    if (!Map || (pairs.length < LARGE_ARRAY_SIZE - 1)) {
  	      pairs.push([key, value]);
  	      return this;
  	    }
  	    cache = this.__data__ = new MapCache(pairs);
  	  }
  	  cache.set(key, value);
  	  return this;
  	}

  	// Add methods to `Stack`.
  	Stack.prototype.clear = stackClear;
  	Stack.prototype['delete'] = stackDelete;
  	Stack.prototype.get = stackGet;
  	Stack.prototype.has = stackHas;
  	Stack.prototype.set = stackSet;

  	/**
  	 * Creates an array of the enumerable property names of the array-like `value`.
  	 *
  	 * @private
  	 * @param {*} value The value to query.
  	 * @param {boolean} inherited Specify returning inherited property names.
  	 * @returns {Array} Returns the array of property names.
  	 */
  	function arrayLikeKeys(value, inherited) {
  	  // Safari 8.1 makes `arguments.callee` enumerable in strict mode.
  	  // Safari 9 makes `arguments.length` enumerable in strict mode.
  	  var result = (isArray(value) || isArguments(value))
  	    ? baseTimes(value.length, String)
  	    : [];

  	  var length = result.length,
  	      skipIndexes = !!length;

  	  for (var key in value) {
  	    if ((hasOwnProperty.call(value, key)) &&
  	        !(skipIndexes && (key == 'length' || isIndex(key, length)))) {
  	      result.push(key);
  	    }
  	  }
  	  return result;
  	}

  	/**
  	 * Assigns `value` to `key` of `object` if the existing value is not equivalent
  	 * using [`SameValueZero`](http://ecma-international.org/ecma-262/7.0/#sec-samevaluezero)
  	 * for equality comparisons.
  	 *
  	 * @private
  	 * @param {Object} object The object to modify.
  	 * @param {string} key The key of the property to assign.
  	 * @param {*} value The value to assign.
  	 */
  	function assignValue(object, key, value) {
  	  var objValue = object[key];
  	  if (!(hasOwnProperty.call(object, key) && eq(objValue, value)) ||
  	      (value === undefined && !(key in object))) {
  	    object[key] = value;
  	  }
  	}

  	/**
  	 * Gets the index at which the `key` is found in `array` of key-value pairs.
  	 *
  	 * @private
  	 * @param {Array} array The array to inspect.
  	 * @param {*} key The key to search for.
  	 * @returns {number} Returns the index of the matched value, else `-1`.
  	 */
  	function assocIndexOf(array, key) {
  	  var length = array.length;
  	  while (length--) {
  	    if (eq(array[length][0], key)) {
  	      return length;
  	    }
  	  }
  	  return -1;
  	}

  	/**
  	 * The base implementation of `_.assign` without support for multiple sources
  	 * or `customizer` functions.
  	 *
  	 * @private
  	 * @param {Object} object The destination object.
  	 * @param {Object} source The source object.
  	 * @returns {Object} Returns `object`.
  	 */
  	function baseAssign(object, source) {
  	  return object && copyObject(source, keys(source), object);
  	}

  	/**
  	 * The base implementation of `_.clone` and `_.cloneDeep` which tracks
  	 * traversed objects.
  	 *
  	 * @private
  	 * @param {*} value The value to clone.
  	 * @param {boolean} [isDeep] Specify a deep clone.
  	 * @param {boolean} [isFull] Specify a clone including symbols.
  	 * @param {Function} [customizer] The function to customize cloning.
  	 * @param {string} [key] The key of `value`.
  	 * @param {Object} [object] The parent object of `value`.
  	 * @param {Object} [stack] Tracks traversed objects and their clone counterparts.
  	 * @returns {*} Returns the cloned value.
  	 */
  	function baseClone(value, isDeep, isFull, customizer, key, object, stack) {
  	  var result;
  	  if (customizer) {
  	    result = object ? customizer(value, key, object, stack) : customizer(value);
  	  }
  	  if (result !== undefined) {
  	    return result;
  	  }
  	  if (!isObject(value)) {
  	    return value;
  	  }
  	  var isArr = isArray(value);
  	  if (isArr) {
  	    result = initCloneArray(value);
  	    if (!isDeep) {
  	      return copyArray(value, result);
  	    }
  	  } else {
  	    var tag = getTag(value),
  	        isFunc = tag == funcTag || tag == genTag;

  	    if (isBuffer(value)) {
  	      return cloneBuffer(value, isDeep);
  	    }
  	    if (tag == objectTag || tag == argsTag || (isFunc && !object)) {
  	      if (isHostObject(value)) {
  	        return object ? value : {};
  	      }
  	      result = initCloneObject(isFunc ? {} : value);
  	      if (!isDeep) {
  	        return copySymbols(value, baseAssign(result, value));
  	      }
  	    } else {
  	      if (!cloneableTags[tag]) {
  	        return object ? value : {};
  	      }
  	      result = initCloneByTag(value, tag, baseClone, isDeep);
  	    }
  	  }
  	  // Check for circular references and return its corresponding clone.
  	  stack || (stack = new Stack);
  	  var stacked = stack.get(value);
  	  if (stacked) {
  	    return stacked;
  	  }
  	  stack.set(value, result);

  	  if (!isArr) {
  	    var props = isFull ? getAllKeys(value) : keys(value);
  	  }
  	  arrayEach(props || value, function(subValue, key) {
  	    if (props) {
  	      key = subValue;
  	      subValue = value[key];
  	    }
  	    // Recursively populate clone (susceptible to call stack limits).
  	    assignValue(result, key, baseClone(subValue, isDeep, isFull, customizer, key, value, stack));
  	  });
  	  return result;
  	}

  	/**
  	 * The base implementation of `_.create` without support for assigning
  	 * properties to the created object.
  	 *
  	 * @private
  	 * @param {Object} prototype The object to inherit from.
  	 * @returns {Object} Returns the new object.
  	 */
  	function baseCreate(proto) {
  	  return isObject(proto) ? objectCreate(proto) : {};
  	}

  	/**
  	 * The base implementation of `getAllKeys` and `getAllKeysIn` which uses
  	 * `keysFunc` and `symbolsFunc` to get the enumerable property names and
  	 * symbols of `object`.
  	 *
  	 * @private
  	 * @param {Object} object The object to query.
  	 * @param {Function} keysFunc The function to get the keys of `object`.
  	 * @param {Function} symbolsFunc The function to get the symbols of `object`.
  	 * @returns {Array} Returns the array of property names and symbols.
  	 */
  	function baseGetAllKeys(object, keysFunc, symbolsFunc) {
  	  var result = keysFunc(object);
  	  return isArray(object) ? result : arrayPush(result, symbolsFunc(object));
  	}

  	/**
  	 * The base implementation of `getTag`.
  	 *
  	 * @private
  	 * @param {*} value The value to query.
  	 * @returns {string} Returns the `toStringTag`.
  	 */
  	function baseGetTag(value) {
  	  return objectToString.call(value);
  	}

  	/**
  	 * The base implementation of `_.isNative` without bad shim checks.
  	 *
  	 * @private
  	 * @param {*} value The value to check.
  	 * @returns {boolean} Returns `true` if `value` is a native function,
  	 *  else `false`.
  	 */
  	function baseIsNative(value) {
  	  if (!isObject(value) || isMasked(value)) {
  	    return false;
  	  }
  	  var pattern = (isFunction(value) || isHostObject(value)) ? reIsNative : reIsHostCtor;
  	  return pattern.test(toSource(value));
  	}

  	/**
  	 * The base implementation of `_.keys` which doesn't treat sparse arrays as dense.
  	 *
  	 * @private
  	 * @param {Object} object The object to query.
  	 * @returns {Array} Returns the array of property names.
  	 */
  	function baseKeys(object) {
  	  if (!isPrototype(object)) {
  	    return nativeKeys(object);
  	  }
  	  var result = [];
  	  for (var key in Object(object)) {
  	    if (hasOwnProperty.call(object, key) && key != 'constructor') {
  	      result.push(key);
  	    }
  	  }
  	  return result;
  	}

  	/**
  	 * Creates a clone of  `buffer`.
  	 *
  	 * @private
  	 * @param {Buffer} buffer The buffer to clone.
  	 * @param {boolean} [isDeep] Specify a deep clone.
  	 * @returns {Buffer} Returns the cloned buffer.
  	 */
  	function cloneBuffer(buffer, isDeep) {
  	  if (isDeep) {
  	    return buffer.slice();
  	  }
  	  var result = new buffer.constructor(buffer.length);
  	  buffer.copy(result);
  	  return result;
  	}

  	/**
  	 * Creates a clone of `arrayBuffer`.
  	 *
  	 * @private
  	 * @param {ArrayBuffer} arrayBuffer The array buffer to clone.
  	 * @returns {ArrayBuffer} Returns the cloned array buffer.
  	 */
  	function cloneArrayBuffer(arrayBuffer) {
  	  var result = new arrayBuffer.constructor(arrayBuffer.byteLength);
  	  new Uint8Array(result).set(new Uint8Array(arrayBuffer));
  	  return result;
  	}

  	/**
  	 * Creates a clone of `dataView`.
  	 *
  	 * @private
  	 * @param {Object} dataView The data view to clone.
  	 * @param {boolean} [isDeep] Specify a deep clone.
  	 * @returns {Object} Returns the cloned data view.
  	 */
  	function cloneDataView(dataView, isDeep) {
  	  var buffer = isDeep ? cloneArrayBuffer(dataView.buffer) : dataView.buffer;
  	  return new dataView.constructor(buffer, dataView.byteOffset, dataView.byteLength);
  	}

  	/**
  	 * Creates a clone of `map`.
  	 *
  	 * @private
  	 * @param {Object} map The map to clone.
  	 * @param {Function} cloneFunc The function to clone values.
  	 * @param {boolean} [isDeep] Specify a deep clone.
  	 * @returns {Object} Returns the cloned map.
  	 */
  	function cloneMap(map, isDeep, cloneFunc) {
  	  var array = isDeep ? cloneFunc(mapToArray(map), true) : mapToArray(map);
  	  return arrayReduce(array, addMapEntry, new map.constructor);
  	}

  	/**
  	 * Creates a clone of `regexp`.
  	 *
  	 * @private
  	 * @param {Object} regexp The regexp to clone.
  	 * @returns {Object} Returns the cloned regexp.
  	 */
  	function cloneRegExp(regexp) {
  	  var result = new regexp.constructor(regexp.source, reFlags.exec(regexp));
  	  result.lastIndex = regexp.lastIndex;
  	  return result;
  	}

  	/**
  	 * Creates a clone of `set`.
  	 *
  	 * @private
  	 * @param {Object} set The set to clone.
  	 * @param {Function} cloneFunc The function to clone values.
  	 * @param {boolean} [isDeep] Specify a deep clone.
  	 * @returns {Object} Returns the cloned set.
  	 */
  	function cloneSet(set, isDeep, cloneFunc) {
  	  var array = isDeep ? cloneFunc(setToArray(set), true) : setToArray(set);
  	  return arrayReduce(array, addSetEntry, new set.constructor);
  	}

  	/**
  	 * Creates a clone of the `symbol` object.
  	 *
  	 * @private
  	 * @param {Object} symbol The symbol object to clone.
  	 * @returns {Object} Returns the cloned symbol object.
  	 */
  	function cloneSymbol(symbol) {
  	  return symbolValueOf ? Object(symbolValueOf.call(symbol)) : {};
  	}

  	/**
  	 * Creates a clone of `typedArray`.
  	 *
  	 * @private
  	 * @param {Object} typedArray The typed array to clone.
  	 * @param {boolean} [isDeep] Specify a deep clone.
  	 * @returns {Object} Returns the cloned typed array.
  	 */
  	function cloneTypedArray(typedArray, isDeep) {
  	  var buffer = isDeep ? cloneArrayBuffer(typedArray.buffer) : typedArray.buffer;
  	  return new typedArray.constructor(buffer, typedArray.byteOffset, typedArray.length);
  	}

  	/**
  	 * Copies the values of `source` to `array`.
  	 *
  	 * @private
  	 * @param {Array} source The array to copy values from.
  	 * @param {Array} [array=[]] The array to copy values to.
  	 * @returns {Array} Returns `array`.
  	 */
  	function copyArray(source, array) {
  	  var index = -1,
  	      length = source.length;

  	  array || (array = Array(length));
  	  while (++index < length) {
  	    array[index] = source[index];
  	  }
  	  return array;
  	}

  	/**
  	 * Copies properties of `source` to `object`.
  	 *
  	 * @private
  	 * @param {Object} source The object to copy properties from.
  	 * @param {Array} props The property identifiers to copy.
  	 * @param {Object} [object={}] The object to copy properties to.
  	 * @param {Function} [customizer] The function to customize copied values.
  	 * @returns {Object} Returns `object`.
  	 */
  	function copyObject(source, props, object, customizer) {
  	  object || (object = {});

  	  var index = -1,
  	      length = props.length;

  	  while (++index < length) {
  	    var key = props[index];

  	    var newValue = undefined;

  	    assignValue(object, key, newValue === undefined ? source[key] : newValue);
  	  }
  	  return object;
  	}

  	/**
  	 * Copies own symbol properties of `source` to `object`.
  	 *
  	 * @private
  	 * @param {Object} source The object to copy symbols from.
  	 * @param {Object} [object={}] The object to copy symbols to.
  	 * @returns {Object} Returns `object`.
  	 */
  	function copySymbols(source, object) {
  	  return copyObject(source, getSymbols(source), object);
  	}

  	/**
  	 * Creates an array of own enumerable property names and symbols of `object`.
  	 *
  	 * @private
  	 * @param {Object} object The object to query.
  	 * @returns {Array} Returns the array of property names and symbols.
  	 */
  	function getAllKeys(object) {
  	  return baseGetAllKeys(object, keys, getSymbols);
  	}

  	/**
  	 * Gets the data for `map`.
  	 *
  	 * @private
  	 * @param {Object} map The map to query.
  	 * @param {string} key The reference key.
  	 * @returns {*} Returns the map data.
  	 */
  	function getMapData(map, key) {
  	  var data = map.__data__;
  	  return isKeyable(key)
  	    ? data[typeof key == 'string' ? 'string' : 'hash']
  	    : data.map;
  	}

  	/**
  	 * Gets the native function at `key` of `object`.
  	 *
  	 * @private
  	 * @param {Object} object The object to query.
  	 * @param {string} key The key of the method to get.
  	 * @returns {*} Returns the function if it's native, else `undefined`.
  	 */
  	function getNative(object, key) {
  	  var value = getValue(object, key);
  	  return baseIsNative(value) ? value : undefined;
  	}

  	/**
  	 * Creates an array of the own enumerable symbol properties of `object`.
  	 *
  	 * @private
  	 * @param {Object} object The object to query.
  	 * @returns {Array} Returns the array of symbols.
  	 */
  	var getSymbols = nativeGetSymbols ? overArg(nativeGetSymbols, Object) : stubArray;

  	/**
  	 * Gets the `toStringTag` of `value`.
  	 *
  	 * @private
  	 * @param {*} value The value to query.
  	 * @returns {string} Returns the `toStringTag`.
  	 */
  	var getTag = baseGetTag;

  	// Fallback for data views, maps, sets, and weak maps in IE 11,
  	// for data views in Edge < 14, and promises in Node.js.
  	if ((DataView && getTag(new DataView(new ArrayBuffer(1))) != dataViewTag) ||
  	    (Map && getTag(new Map) != mapTag) ||
  	    (Promise && getTag(Promise.resolve()) != promiseTag) ||
  	    (Set && getTag(new Set) != setTag) ||
  	    (WeakMap && getTag(new WeakMap) != weakMapTag)) {
  	  getTag = function(value) {
  	    var result = objectToString.call(value),
  	        Ctor = result == objectTag ? value.constructor : undefined,
  	        ctorString = Ctor ? toSource(Ctor) : undefined;

  	    if (ctorString) {
  	      switch (ctorString) {
  	        case dataViewCtorString: return dataViewTag;
  	        case mapCtorString: return mapTag;
  	        case promiseCtorString: return promiseTag;
  	        case setCtorString: return setTag;
  	        case weakMapCtorString: return weakMapTag;
  	      }
  	    }
  	    return result;
  	  };
  	}

  	/**
  	 * Initializes an array clone.
  	 *
  	 * @private
  	 * @param {Array} array The array to clone.
  	 * @returns {Array} Returns the initialized clone.
  	 */
  	function initCloneArray(array) {
  	  var length = array.length,
  	      result = array.constructor(length);

  	  // Add properties assigned by `RegExp#exec`.
  	  if (length && typeof array[0] == 'string' && hasOwnProperty.call(array, 'index')) {
  	    result.index = array.index;
  	    result.input = array.input;
  	  }
  	  return result;
  	}

  	/**
  	 * Initializes an object clone.
  	 *
  	 * @private
  	 * @param {Object} object The object to clone.
  	 * @returns {Object} Returns the initialized clone.
  	 */
  	function initCloneObject(object) {
  	  return (typeof object.constructor == 'function' && !isPrototype(object))
  	    ? baseCreate(getPrototype(object))
  	    : {};
  	}

  	/**
  	 * Initializes an object clone based on its `toStringTag`.
  	 *
  	 * **Note:** This function only supports cloning values with tags of
  	 * `Boolean`, `Date`, `Error`, `Number`, `RegExp`, or `String`.
  	 *
  	 * @private
  	 * @param {Object} object The object to clone.
  	 * @param {string} tag The `toStringTag` of the object to clone.
  	 * @param {Function} cloneFunc The function to clone values.
  	 * @param {boolean} [isDeep] Specify a deep clone.
  	 * @returns {Object} Returns the initialized clone.
  	 */
  	function initCloneByTag(object, tag, cloneFunc, isDeep) {
  	  var Ctor = object.constructor;
  	  switch (tag) {
  	    case arrayBufferTag:
  	      return cloneArrayBuffer(object);

  	    case boolTag:
  	    case dateTag:
  	      return new Ctor(+object);

  	    case dataViewTag:
  	      return cloneDataView(object, isDeep);

  	    case float32Tag: case float64Tag:
  	    case int8Tag: case int16Tag: case int32Tag:
  	    case uint8Tag: case uint8ClampedTag: case uint16Tag: case uint32Tag:
  	      return cloneTypedArray(object, isDeep);

  	    case mapTag:
  	      return cloneMap(object, isDeep, cloneFunc);

  	    case numberTag:
  	    case stringTag:
  	      return new Ctor(object);

  	    case regexpTag:
  	      return cloneRegExp(object);

  	    case setTag:
  	      return cloneSet(object, isDeep, cloneFunc);

  	    case symbolTag:
  	      return cloneSymbol(object);
  	  }
  	}

  	/**
  	 * Checks if `value` is a valid array-like index.
  	 *
  	 * @private
  	 * @param {*} value The value to check.
  	 * @param {number} [length=MAX_SAFE_INTEGER] The upper bounds of a valid index.
  	 * @returns {boolean} Returns `true` if `value` is a valid index, else `false`.
  	 */
  	function isIndex(value, length) {
  	  length = length == null ? MAX_SAFE_INTEGER : length;
  	  return !!length &&
  	    (typeof value == 'number' || reIsUint.test(value)) &&
  	    (value > -1 && value % 1 == 0 && value < length);
  	}

  	/**
  	 * Checks if `value` is suitable for use as unique object key.
  	 *
  	 * @private
  	 * @param {*} value The value to check.
  	 * @returns {boolean} Returns `true` if `value` is suitable, else `false`.
  	 */
  	function isKeyable(value) {
  	  var type = typeof value;
  	  return (type == 'string' || type == 'number' || type == 'symbol' || type == 'boolean')
  	    ? (value !== '__proto__')
  	    : (value === null);
  	}

  	/**
  	 * Checks if `func` has its source masked.
  	 *
  	 * @private
  	 * @param {Function} func The function to check.
  	 * @returns {boolean} Returns `true` if `func` is masked, else `false`.
  	 */
  	function isMasked(func) {
  	  return !!maskSrcKey && (maskSrcKey in func);
  	}

  	/**
  	 * Checks if `value` is likely a prototype object.
  	 *
  	 * @private
  	 * @param {*} value The value to check.
  	 * @returns {boolean} Returns `true` if `value` is a prototype, else `false`.
  	 */
  	function isPrototype(value) {
  	  var Ctor = value && value.constructor,
  	      proto = (typeof Ctor == 'function' && Ctor.prototype) || objectProto;

  	  return value === proto;
  	}

  	/**
  	 * Converts `func` to its source code.
  	 *
  	 * @private
  	 * @param {Function} func The function to process.
  	 * @returns {string} Returns the source code.
  	 */
  	function toSource(func) {
  	  if (func != null) {
  	    try {
  	      return funcToString.call(func);
  	    } catch (e) {}
  	    try {
  	      return (func + '');
  	    } catch (e) {}
  	  }
  	  return '';
  	}

  	/**
  	 * This method is like `_.clone` except that it recursively clones `value`.
  	 *
  	 * @static
  	 * @memberOf _
  	 * @since 1.0.0
  	 * @category Lang
  	 * @param {*} value The value to recursively clone.
  	 * @returns {*} Returns the deep cloned value.
  	 * @see _.clone
  	 * @example
  	 *
  	 * var objects = [{ 'a': 1 }, { 'b': 2 }];
  	 *
  	 * var deep = _.cloneDeep(objects);
  	 * console.log(deep[0] === objects[0]);
  	 * // => false
  	 */
  	function cloneDeep(value) {
  	  return baseClone(value, true, true);
  	}

  	/**
  	 * Performs a
  	 * [`SameValueZero`](http://ecma-international.org/ecma-262/7.0/#sec-samevaluezero)
  	 * comparison between two values to determine if they are equivalent.
  	 *
  	 * @static
  	 * @memberOf _
  	 * @since 4.0.0
  	 * @category Lang
  	 * @param {*} value The value to compare.
  	 * @param {*} other The other value to compare.
  	 * @returns {boolean} Returns `true` if the values are equivalent, else `false`.
  	 * @example
  	 *
  	 * var object = { 'a': 1 };
  	 * var other = { 'a': 1 };
  	 *
  	 * _.eq(object, object);
  	 * // => true
  	 *
  	 * _.eq(object, other);
  	 * // => false
  	 *
  	 * _.eq('a', 'a');
  	 * // => true
  	 *
  	 * _.eq('a', Object('a'));
  	 * // => false
  	 *
  	 * _.eq(NaN, NaN);
  	 * // => true
  	 */
  	function eq(value, other) {
  	  return value === other || (value !== value && other !== other);
  	}

  	/**
  	 * Checks if `value` is likely an `arguments` object.
  	 *
  	 * @static
  	 * @memberOf _
  	 * @since 0.1.0
  	 * @category Lang
  	 * @param {*} value The value to check.
  	 * @returns {boolean} Returns `true` if `value` is an `arguments` object,
  	 *  else `false`.
  	 * @example
  	 *
  	 * _.isArguments(function() { return arguments; }());
  	 * // => true
  	 *
  	 * _.isArguments([1, 2, 3]);
  	 * // => false
  	 */
  	function isArguments(value) {
  	  // Safari 8.1 makes `arguments.callee` enumerable in strict mode.
  	  return isArrayLikeObject(value) && hasOwnProperty.call(value, 'callee') &&
  	    (!propertyIsEnumerable.call(value, 'callee') || objectToString.call(value) == argsTag);
  	}

  	/**
  	 * Checks if `value` is classified as an `Array` object.
  	 *
  	 * @static
  	 * @memberOf _
  	 * @since 0.1.0
  	 * @category Lang
  	 * @param {*} value The value to check.
  	 * @returns {boolean} Returns `true` if `value` is an array, else `false`.
  	 * @example
  	 *
  	 * _.isArray([1, 2, 3]);
  	 * // => true
  	 *
  	 * _.isArray(document.body.children);
  	 * // => false
  	 *
  	 * _.isArray('abc');
  	 * // => false
  	 *
  	 * _.isArray(_.noop);
  	 * // => false
  	 */
  	var isArray = Array.isArray;

  	/**
  	 * Checks if `value` is array-like. A value is considered array-like if it's
  	 * not a function and has a `value.length` that's an integer greater than or
  	 * equal to `0` and less than or equal to `Number.MAX_SAFE_INTEGER`.
  	 *
  	 * @static
  	 * @memberOf _
  	 * @since 4.0.0
  	 * @category Lang
  	 * @param {*} value The value to check.
  	 * @returns {boolean} Returns `true` if `value` is array-like, else `false`.
  	 * @example
  	 *
  	 * _.isArrayLike([1, 2, 3]);
  	 * // => true
  	 *
  	 * _.isArrayLike(document.body.children);
  	 * // => true
  	 *
  	 * _.isArrayLike('abc');
  	 * // => true
  	 *
  	 * _.isArrayLike(_.noop);
  	 * // => false
  	 */
  	function isArrayLike(value) {
  	  return value != null && isLength(value.length) && !isFunction(value);
  	}

  	/**
  	 * This method is like `_.isArrayLike` except that it also checks if `value`
  	 * is an object.
  	 *
  	 * @static
  	 * @memberOf _
  	 * @since 4.0.0
  	 * @category Lang
  	 * @param {*} value The value to check.
  	 * @returns {boolean} Returns `true` if `value` is an array-like object,
  	 *  else `false`.
  	 * @example
  	 *
  	 * _.isArrayLikeObject([1, 2, 3]);
  	 * // => true
  	 *
  	 * _.isArrayLikeObject(document.body.children);
  	 * // => true
  	 *
  	 * _.isArrayLikeObject('abc');
  	 * // => false
  	 *
  	 * _.isArrayLikeObject(_.noop);
  	 * // => false
  	 */
  	function isArrayLikeObject(value) {
  	  return isObjectLike(value) && isArrayLike(value);
  	}

  	/**
  	 * Checks if `value` is a buffer.
  	 *
  	 * @static
  	 * @memberOf _
  	 * @since 4.3.0
  	 * @category Lang
  	 * @param {*} value The value to check.
  	 * @returns {boolean} Returns `true` if `value` is a buffer, else `false`.
  	 * @example
  	 *
  	 * _.isBuffer(new Buffer(2));
  	 * // => true
  	 *
  	 * _.isBuffer(new Uint8Array(2));
  	 * // => false
  	 */
  	var isBuffer = nativeIsBuffer || stubFalse;

  	/**
  	 * Checks if `value` is classified as a `Function` object.
  	 *
  	 * @static
  	 * @memberOf _
  	 * @since 0.1.0
  	 * @category Lang
  	 * @param {*} value The value to check.
  	 * @returns {boolean} Returns `true` if `value` is a function, else `false`.
  	 * @example
  	 *
  	 * _.isFunction(_);
  	 * // => true
  	 *
  	 * _.isFunction(/abc/);
  	 * // => false
  	 */
  	function isFunction(value) {
  	  // The use of `Object#toString` avoids issues with the `typeof` operator
  	  // in Safari 8-9 which returns 'object' for typed array and other constructors.
  	  var tag = isObject(value) ? objectToString.call(value) : '';
  	  return tag == funcTag || tag == genTag;
  	}

  	/**
  	 * Checks if `value` is a valid array-like length.
  	 *
  	 * **Note:** This method is loosely based on
  	 * [`ToLength`](http://ecma-international.org/ecma-262/7.0/#sec-tolength).
  	 *
  	 * @static
  	 * @memberOf _
  	 * @since 4.0.0
  	 * @category Lang
  	 * @param {*} value The value to check.
  	 * @returns {boolean} Returns `true` if `value` is a valid length, else `false`.
  	 * @example
  	 *
  	 * _.isLength(3);
  	 * // => true
  	 *
  	 * _.isLength(Number.MIN_VALUE);
  	 * // => false
  	 *
  	 * _.isLength(Infinity);
  	 * // => false
  	 *
  	 * _.isLength('3');
  	 * // => false
  	 */
  	function isLength(value) {
  	  return typeof value == 'number' &&
  	    value > -1 && value % 1 == 0 && value <= MAX_SAFE_INTEGER;
  	}

  	/**
  	 * Checks if `value` is the
  	 * [language type](http://www.ecma-international.org/ecma-262/7.0/#sec-ecmascript-language-types)
  	 * of `Object`. (e.g. arrays, functions, objects, regexes, `new Number(0)`, and `new String('')`)
  	 *
  	 * @static
  	 * @memberOf _
  	 * @since 0.1.0
  	 * @category Lang
  	 * @param {*} value The value to check.
  	 * @returns {boolean} Returns `true` if `value` is an object, else `false`.
  	 * @example
  	 *
  	 * _.isObject({});
  	 * // => true
  	 *
  	 * _.isObject([1, 2, 3]);
  	 * // => true
  	 *
  	 * _.isObject(_.noop);
  	 * // => true
  	 *
  	 * _.isObject(null);
  	 * // => false
  	 */
  	function isObject(value) {
  	  var type = typeof value;
  	  return !!value && (type == 'object' || type == 'function');
  	}

  	/**
  	 * Checks if `value` is object-like. A value is object-like if it's not `null`
  	 * and has a `typeof` result of "object".
  	 *
  	 * @static
  	 * @memberOf _
  	 * @since 4.0.0
  	 * @category Lang
  	 * @param {*} value The value to check.
  	 * @returns {boolean} Returns `true` if `value` is object-like, else `false`.
  	 * @example
  	 *
  	 * _.isObjectLike({});
  	 * // => true
  	 *
  	 * _.isObjectLike([1, 2, 3]);
  	 * // => true
  	 *
  	 * _.isObjectLike(_.noop);
  	 * // => false
  	 *
  	 * _.isObjectLike(null);
  	 * // => false
  	 */
  	function isObjectLike(value) {
  	  return !!value && typeof value == 'object';
  	}

  	/**
  	 * Creates an array of the own enumerable property names of `object`.
  	 *
  	 * **Note:** Non-object values are coerced to objects. See the
  	 * [ES spec](http://ecma-international.org/ecma-262/7.0/#sec-object.keys)
  	 * for more details.
  	 *
  	 * @static
  	 * @since 0.1.0
  	 * @memberOf _
  	 * @category Object
  	 * @param {Object} object The object to query.
  	 * @returns {Array} Returns the array of property names.
  	 * @example
  	 *
  	 * function Foo() {
  	 *   this.a = 1;
  	 *   this.b = 2;
  	 * }
  	 *
  	 * Foo.prototype.c = 3;
  	 *
  	 * _.keys(new Foo);
  	 * // => ['a', 'b'] (iteration order is not guaranteed)
  	 *
  	 * _.keys('hi');
  	 * // => ['0', '1']
  	 */
  	function keys(object) {
  	  return isArrayLike(object) ? arrayLikeKeys(object) : baseKeys(object);
  	}

  	/**
  	 * This method returns a new empty array.
  	 *
  	 * @static
  	 * @memberOf _
  	 * @since 4.13.0
  	 * @category Util
  	 * @returns {Array} Returns the new empty array.
  	 * @example
  	 *
  	 * var arrays = _.times(2, _.stubArray);
  	 *
  	 * console.log(arrays);
  	 * // => [[], []]
  	 *
  	 * console.log(arrays[0] === arrays[1]);
  	 * // => false
  	 */
  	function stubArray() {
  	  return [];
  	}

  	/**
  	 * This method returns `false`.
  	 *
  	 * @static
  	 * @memberOf _
  	 * @since 4.13.0
  	 * @category Util
  	 * @returns {boolean} Returns `false`.
  	 * @example
  	 *
  	 * _.times(2, _.stubFalse);
  	 * // => [false, false]
  	 */
  	function stubFalse() {
  	  return false;
  	}

  	module.exports = cloneDeep; 
  } (lodash_clonedeep, lodash_clonedeep.exports));

  var lodash_clonedeepExports = lodash_clonedeep.exports;
  var cloneDeep = /*@__PURE__*/getDefaultExportFromCjs$1(lodash_clonedeepExports);

  function applyContextDelta(context, delta, logger) {
      try {
          if (logger?.canPublish("trace")) {
              logger?.trace(`applying context delta ${JSON.stringify(delta)} on context ${JSON.stringify(context)}`);
          }
          if (!delta) {
              return context;
          }
          if (delta.reset) {
              context = { ...delta.reset };
              return context;
          }
          context = deepClone(context, undefined);
          if (delta.commands) {
              for (const command of delta.commands) {
                  if (command.type === "remove") {
                      deletePath(context, command.path);
                  }
                  else if (command.type === "set") {
                      setValueToPath(context, command.value, command.path);
                  }
              }
              return context;
          }
          const added = delta.added;
          const updated = delta.updated;
          const removed = delta.removed;
          if (added) {
              Object.keys(added).forEach((key) => {
                  context[key] = added[key];
              });
          }
          if (updated) {
              Object.keys(updated).forEach((key) => {
                  mergeObjectsProperties(key, context, updated);
              });
          }
          if (removed) {
              removed.forEach((key) => {
                  delete context[key];
              });
          }
          return context;
      }
      catch (e) {
          logger?.error(`error applying context delta ${JSON.stringify(delta)} on context ${JSON.stringify(context)}`, e);
          return context;
      }
  }
  function deepClone(obj, hash) {
      return cloneDeep(obj);
  }
  const mergeObjectsProperties = (key, what, withWhat) => {
      const right = withWhat[key];
      if (right === undefined) {
          return what;
      }
      const left = what[key];
      if (!left || !right) {
          what[key] = right;
          return what;
      }
      if (typeof left === "string" ||
          typeof left === "number" ||
          typeof left === "boolean" ||
          typeof right === "string" ||
          typeof right === "number" ||
          typeof right === "boolean" ||
          Array.isArray(left) ||
          Array.isArray(right)) {
          what[key] = right;
          return what;
      }
      what[key] = Object.assign({}, left, right);
      return what;
  };
  function deepEqual(x, y) {
      if (x === y) {
          return true;
      }
      if (!(x instanceof Object) || !(y instanceof Object)) {
          return false;
      }
      if (x.constructor !== y.constructor) {
          return false;
      }
      for (const p in x) {
          if (!x.hasOwnProperty(p)) {
              continue;
          }
          if (!y.hasOwnProperty(p)) {
              return false;
          }
          if (x[p] === y[p]) {
              continue;
          }
          if (typeof (x[p]) !== "object") {
              return false;
          }
          if (!deepEqual(x[p], y[p])) {
              return false;
          }
      }
      for (const p in y) {
          if (y.hasOwnProperty(p) && !x.hasOwnProperty(p)) {
              return false;
          }
      }
      return true;
  }
  function setValueToPath(obj, value, path) {
      const pathArr = path.split(".");
      let i;
      for (i = 0; i < pathArr.length - 1; i++) {
          if (!obj[pathArr[i]]) {
              obj[pathArr[i]] = {};
          }
          if (typeof obj[pathArr[i]] !== "object") {
              obj[pathArr[i]] = {};
          }
          obj = obj[pathArr[i]];
      }
      obj[pathArr[i]] = value;
  }
  function isSubset(superObj, subObj) {
      return Object.keys(subObj).every((ele) => {
          if (typeof subObj[ele] === "object") {
              return isSubset(superObj?.[ele] || {}, subObj[ele] || {});
          }
          return subObj[ele] === superObj?.[ele];
      });
  }
  function deletePath(obj, path) {
      const pathArr = path.split(".");
      let i;
      for (i = 0; i < pathArr.length - 1; i++) {
          if (!obj[pathArr[i]]) {
              return;
          }
          obj = obj[pathArr[i]];
      }
      delete obj[pathArr[i]];
  }

  let GW3Bridge$1 = class GW3Bridge {
      _logger;
      _connection;
      _trackAllContexts;
      _reAnnounceKnownContexts;
      _gw3Session;
      _contextNameToData = {};
      _gw3Subscriptions = [];
      _nextCallbackSubscriptionNumber = 0;
      _creationPromises = {};
      _contextNameToId = {};
      _contextIdToName = {};
      _protocolVersion = undefined;
      _contextsTempCache = {};
      _contextsSubscriptionsCache = [];
      _systemContextsSubKey;
      get protocolVersion() {
          if (!this._protocolVersion) {
              const contextsDomainInfo = this._connection.availableDomains.find((d) => d.uri === "context");
              this._protocolVersion = contextsDomainInfo?.version ?? 1;
          }
          return this._protocolVersion;
      }
      get setPathSupported() {
          return this.protocolVersion >= 2;
      }
      constructor(config) {
          this._connection = config.connection;
          this._logger = config.logger;
          this._trackAllContexts = config.trackAllContexts;
          this._reAnnounceKnownContexts = config.reAnnounceKnownContexts;
          this._gw3Session = this._connection.domain("global", [
              GW_MESSAGE_CONTEXT_CREATED,
              GW_MESSAGE_SUBSCRIBED_CONTEXT,
              GW_MESSAGE_CONTEXT_DESTROYED,
              GW_MESSAGE_CONTEXT_UPDATED,
          ]);
          this._gw3Session.disconnected(this.resetState.bind(this));
          this._gw3Session.onJoined((wasReconnect) => {
              if (!wasReconnect) {
                  return;
              }
              if (!this._reAnnounceKnownContexts) {
                  return this._connection.setLibReAnnounced({ name: "contexts" });
              }
              this.reInitiateState().then(() => this._connection.setLibReAnnounced({ name: "contexts" }));
          });
          this.subscribeToContextCreatedMessages();
          this.subscribeToContextUpdatedMessages();
          this.subscribeToContextDestroyedMessages();
          this._connection.replayer?.drain(ContextMessageReplaySpec.name, (message) => {
              const type = message.type;
              if (!type) {
                  return;
              }
              if (type === GW_MESSAGE_CONTEXT_CREATED ||
                  type === GW_MESSAGE_CONTEXT_ADDED ||
                  type === GW_MESSAGE_ACTIVITY_CREATED) {
                  this.handleContextCreatedMessage(message);
              }
              else if (type === GW_MESSAGE_SUBSCRIBED_CONTEXT ||
                  type === GW_MESSAGE_CONTEXT_UPDATED ||
                  type === GW_MESSAGE_JOINED_ACTIVITY) {
                  this.handleContextUpdatedMessage(message);
              }
              else if (type === GW_MESSAGE_CONTEXT_DESTROYED ||
                  type === GW_MESSAGE_ACTIVITY_DESTROYED) {
                  this.handleContextDestroyedMessage(message);
              }
          });
      }
      dispose() {
          for (const sub of this._gw3Subscriptions) {
              this._connection.off(sub);
          }
          this._gw3Subscriptions.length = 0;
          for (const contextName in this._contextNameToData) {
              if (this._contextNameToId.hasOwnProperty(contextName)) {
                  delete this._contextNameToData[contextName];
              }
          }
      }
      createContext(name, data) {
          if (name in this._creationPromises) {
              return this._creationPromises[name];
          }
          this._creationPromises[name] =
              this._gw3Session
                  .send({
                  type: GW_MESSAGE_CREATE_CONTEXT,
                  domain: "global",
                  name,
                  data,
                  lifetime: "retained",
              })
                  .then((createContextMsg) => {
                  this._contextNameToId[name] = createContextMsg.context_id;
                  this._contextIdToName[createContextMsg.context_id] = name;
                  const contextData = this._contextNameToData[name] || new GW3ContextData(createContextMsg.context_id, name, true, undefined);
                  contextData.isAnnounced = true;
                  contextData.name = name;
                  contextData.contextId = createContextMsg.context_id;
                  contextData.context = createContextMsg.data || deepClone(data);
                  contextData.hasReceivedSnapshot = true;
                  this._contextNameToData[name] = contextData;
                  delete this._creationPromises[name];
                  return createContextMsg.context_id;
              });
          return this._creationPromises[name];
      }
      all() {
          return Object.keys(this._contextNameToData)
              .filter((name) => this._contextNameToData[name].isAnnounced);
      }
      async update(name, delta) {
          if (delta) {
              delta = deepClone(delta);
          }
          if (name in this._creationPromises) {
              await this._creationPromises[name];
          }
          const contextData = this._contextNameToData[name];
          if (!contextData || !contextData.isAnnounced) {
              return this.createContext(name, delta);
          }
          let currentContext = contextData.context;
          if (!contextData.hasCallbacks()) {
              currentContext = await this.get(contextData.name);
          }
          const calculatedDelta = this.setPathSupported ?
              this.calculateContextDeltaV2(currentContext, delta) :
              this.calculateContextDeltaV1(currentContext, delta);
          if (!Object.keys(calculatedDelta.added).length
              && !Object.keys(calculatedDelta.updated).length
              && !calculatedDelta.removed.length
              && !calculatedDelta.commands?.length) {
              return Promise.resolve();
          }
          return this._gw3Session
              .send({
              type: GW_MESSAGE_UPDATE_CONTEXT,
              domain: "global",
              context_id: contextData.contextId,
              delta: calculatedDelta,
          }, {}, { skipPeerId: false })
              .then((gwResponse) => {
              this.handleUpdated(contextData, calculatedDelta, {
                  updaterId: gwResponse.peer_id
              });
          });
      }
      async set(name, data) {
          if (data) {
              data = deepClone(data);
          }
          if (name in this._creationPromises) {
              await this._creationPromises[name];
          }
          const contextData = this._contextNameToData[name];
          if (!contextData || !contextData.isAnnounced) {
              return this.createContext(name, data);
          }
          return this._gw3Session
              .send({
              type: GW_MESSAGE_UPDATE_CONTEXT,
              domain: "global",
              context_id: contextData.contextId,
              delta: { reset: data },
          }, {}, { skipPeerId: false })
              .then((gwResponse) => {
              this.handleUpdated(contextData, {
                  reset: data,
                  added: {},
                  removed: [],
                  updated: {}
              }, {
                  updaterId: gwResponse.peer_id
              });
          });
      }
      setPath(name, path, value) {
          if (!this.setPathSupported) {
              return Promise.reject("glue.contexts.setPath operation is not supported, use Glue42 3.10 or later");
          }
          return this.setPaths(name, [{ path, value }]);
      }
      async setPaths(name, pathValues) {
          if (!this.setPathSupported) {
              return Promise.reject("glue.contexts.setPaths operation is not supported, use Glue42 3.10 or later");
          }
          if (pathValues) {
              pathValues = deepClone(pathValues);
          }
          if (name in this._creationPromises) {
              await this._creationPromises[name];
          }
          const contextData = this._contextNameToData[name];
          if (!contextData || !contextData.isAnnounced) {
              const obj = {};
              for (const pathValue of pathValues) {
                  setValueToPath(obj, pathValue.value, pathValue.path);
              }
              return this.createContext(name, obj);
          }
          const commands = [];
          for (const pathValue of pathValues) {
              if (pathValue.value === null) {
                  commands.push({ type: "remove", path: pathValue.path });
              }
              else {
                  commands.push({ type: "set", path: pathValue.path, value: pathValue.value });
              }
          }
          return this._gw3Session
              .send({
              type: GW_MESSAGE_UPDATE_CONTEXT,
              domain: "global",
              context_id: contextData.contextId,
              delta: { commands }
          }, {}, { skipPeerId: false })
              .then((gwResponse) => {
              this.handleUpdated(contextData, {
                  added: {},
                  removed: [],
                  updated: {},
                  commands
              }, {
                  updaterId: gwResponse.peer_id
              });
          });
      }
      async get(name) {
          if (name in this._creationPromises) {
              await this._creationPromises[name];
          }
          const contextData = this._contextNameToData[name];
          if (!contextData || !contextData.isAnnounced) {
              return Promise.resolve({});
          }
          if (contextData && (!contextData.hasCallbacks() || !contextData.hasReceivedSnapshot)) {
              return new Promise((resolve) => {
                  this.subscribe(name, (data, _d, _r, un) => {
                      this.unsubscribe(un);
                      resolve(data);
                  });
              });
          }
          const context = contextData?.context ?? {};
          return Promise.resolve(deepClone(context));
      }
      async subscribe(name, callback, subscriptionKey) {
          if (name in this._creationPromises) {
              await this._creationPromises[name];
          }
          const thisCallbackSubscriptionNumber = typeof subscriptionKey === "undefined" ? this._nextCallbackSubscriptionNumber : subscriptionKey;
          if (typeof subscriptionKey === "undefined") {
              this._nextCallbackSubscriptionNumber += 1;
          }
          if (this._contextsSubscriptionsCache.every((subscription) => subscription.subKey !== this._nextCallbackSubscriptionNumber)) {
              this._contextsSubscriptionsCache.push({ contextName: name, subKey: thisCallbackSubscriptionNumber, callback });
          }
          let contextData = this._contextNameToData[name];
          if (!contextData ||
              !contextData.isAnnounced) {
              contextData = contextData || new GW3ContextData(undefined, name, false, undefined);
              this._contextNameToData[name] = contextData;
              contextData.updateCallbacks[thisCallbackSubscriptionNumber] = callback;
              return Promise.resolve(thisCallbackSubscriptionNumber);
          }
          const hadCallbacks = contextData.hasCallbacks();
          contextData.updateCallbacks[thisCallbackSubscriptionNumber] = callback;
          if (!hadCallbacks) {
              if (!contextData.joinedActivity) {
                  if (contextData.context && contextData.sentExplicitSubscription) {
                      if (contextData.hasReceivedSnapshot) {
                          const clone = deepClone(contextData.context);
                          callback(clone, clone, [], thisCallbackSubscriptionNumber);
                      }
                      return Promise.resolve(thisCallbackSubscriptionNumber);
                  }
                  return this.sendSubscribe(contextData)
                      .then(() => thisCallbackSubscriptionNumber);
              }
              else {
                  if (contextData.hasReceivedSnapshot) {
                      const clone = deepClone(contextData.context);
                      callback(clone, clone, [], thisCallbackSubscriptionNumber);
                  }
                  return Promise.resolve(thisCallbackSubscriptionNumber);
              }
          }
          else {
              if (contextData.hasReceivedSnapshot) {
                  const clone = deepClone(contextData.context);
                  callback(clone, clone, [], thisCallbackSubscriptionNumber);
              }
              return Promise.resolve(thisCallbackSubscriptionNumber);
          }
      }
      unsubscribe(subscriptionKey) {
          this._contextsSubscriptionsCache = this._contextsSubscriptionsCache.filter((subscription) => subscription.subKey !== subscriptionKey);
          for (const name of Object.keys(this._contextNameToData)) {
              const contextData = this._contextNameToData[name];
              if (!contextData) {
                  return;
              }
              const hadCallbacks = contextData.hasCallbacks();
              delete contextData.updateCallbacks[subscriptionKey];
              if (contextData.isAnnounced &&
                  hadCallbacks &&
                  !contextData.hasCallbacks() &&
                  contextData.sentExplicitSubscription) {
                  this.sendUnsubscribe(contextData).catch(() => { });
              }
              if (!contextData.isAnnounced &&
                  !contextData.hasCallbacks()) {
                  delete this._contextNameToData[name];
              }
          }
      }
      async destroy(name) {
          if (name in this._creationPromises) {
              await this._creationPromises[name];
          }
          const contextData = this._contextNameToData[name];
          if (!contextData) {
              return Promise.reject(`context with ${name} does not exist`);
          }
          return this._gw3Session
              .send({
              type: GW_MESSAGE_DESTROY_CONTEXT,
              domain: "global",
              context_id: contextData.contextId,
          }).then((_) => undefined);
      }
      handleUpdated(contextData, delta, extraData) {
          const oldContext = contextData.context;
          contextData.context = applyContextDelta(contextData.context, delta, this._logger);
          contextData.hasReceivedSnapshot = true;
          if (this._contextNameToData[contextData.name] === contextData &&
              !deepEqual(oldContext, contextData.context)) {
              this.invokeUpdateCallbacks(contextData, delta, extraData);
          }
      }
      subscribeToContextCreatedMessages() {
          const createdMessageTypes = [
              GW_MESSAGE_CONTEXT_ADDED,
              GW_MESSAGE_CONTEXT_CREATED,
              GW_MESSAGE_ACTIVITY_CREATED,
          ];
          for (const createdMessageType of createdMessageTypes) {
              const sub = this._connection.on(createdMessageType, this.handleContextCreatedMessage.bind(this));
              this._gw3Subscriptions.push(sub);
          }
      }
      handleContextCreatedMessage(contextCreatedMsg) {
          const createdMessageType = contextCreatedMsg.type;
          if (createdMessageType === GW_MESSAGE_ACTIVITY_CREATED) {
              this._contextNameToId[contextCreatedMsg.activity_id] = contextCreatedMsg.context_id;
              this._contextIdToName[contextCreatedMsg.context_id] = contextCreatedMsg.activity_id;
          }
          else if (createdMessageType === GW_MESSAGE_CONTEXT_ADDED) {
              this._contextNameToId[contextCreatedMsg.name] = contextCreatedMsg.context_id;
              this._contextIdToName[contextCreatedMsg.context_id] = contextCreatedMsg.name;
          }
          else ;
          const name = this._contextIdToName[contextCreatedMsg.context_id];
          if (!name) {
              throw new Error("Received created event for context with unknown name: " + contextCreatedMsg.context_id);
          }
          if (!this._contextNameToId[name]) {
              throw new Error("Received created event for context with unknown id: " + contextCreatedMsg.context_id);
          }
          let contextData = this._contextNameToData[name];
          if (contextData) {
              if (contextData.isAnnounced) {
                  return;
              }
              else {
                  if (!contextData.hasCallbacks()) {
                      throw new Error("Assertion failure: contextData.hasCallbacks()");
                  }
                  contextData.isAnnounced = true;
                  contextData.contextId = contextCreatedMsg.context_id;
                  contextData.activityId = contextCreatedMsg.activity_id;
                  if (!contextData.sentExplicitSubscription) {
                      this.sendSubscribe(contextData);
                  }
              }
          }
          else {
              this._contextNameToData[name] = contextData =
                  new GW3ContextData(contextCreatedMsg.context_id, name, true, contextCreatedMsg.activity_id);
              if (this._trackAllContexts) {
                  this.subscribe(name, () => { }).then((subKey) => this._systemContextsSubKey = subKey);
              }
          }
      }
      subscribeToContextUpdatedMessages() {
          const updatedMessageTypes = [
              GW_MESSAGE_CONTEXT_UPDATED,
              GW_MESSAGE_SUBSCRIBED_CONTEXT,
              GW_MESSAGE_JOINED_ACTIVITY,
          ];
          for (const updatedMessageType of updatedMessageTypes) {
              const sub = this._connection.on(updatedMessageType, this.handleContextUpdatedMessage.bind(this));
              this._gw3Subscriptions.push(sub);
          }
      }
      handleContextUpdatedMessage(contextUpdatedMsg) {
          const updatedMessageType = contextUpdatedMsg.type;
          const contextId = contextUpdatedMsg.context_id;
          let contextData = this._contextNameToData[this._contextIdToName[contextId]];
          const justSeen = !contextData || !contextData.isAnnounced;
          if (updatedMessageType === GW_MESSAGE_JOINED_ACTIVITY) {
              if (!contextData) {
                  contextData =
                      this._contextNameToData[contextUpdatedMsg.activity_id] ||
                          new GW3ContextData(contextId, contextUpdatedMsg.activity_id, true, contextUpdatedMsg.activity_id);
              }
              this._contextNameToData[contextUpdatedMsg.activity_id] = contextData;
              this._contextIdToName[contextId] = contextUpdatedMsg.activity_id;
              this._contextNameToId[contextUpdatedMsg.activity_id] = contextId;
              contextData.contextId = contextId;
              contextData.isAnnounced = true;
              contextData.activityId = contextUpdatedMsg.activity_id;
              contextData.joinedActivity = true;
          }
          else {
              if (!contextData || !contextData.isAnnounced) {
                  if (updatedMessageType === GW_MESSAGE_SUBSCRIBED_CONTEXT) {
                      contextData = contextData || new GW3ContextData(contextId, contextUpdatedMsg.name, true, undefined);
                      contextData.sentExplicitSubscription = true;
                      this._contextNameToData[contextUpdatedMsg.name] = contextData;
                      this._contextIdToName[contextId] = contextUpdatedMsg.name;
                      this._contextNameToId[contextUpdatedMsg.name] = contextId;
                  }
                  else {
                      this._logger.error(`Received 'update' for unknown context: ${contextId}`);
                  }
                  return;
              }
          }
          const oldContext = contextData.context;
          contextData.hasReceivedSnapshot = true;
          if (updatedMessageType === GW_MESSAGE_SUBSCRIBED_CONTEXT) {
              contextData.context = contextUpdatedMsg.data || {};
          }
          else if (updatedMessageType === GW_MESSAGE_JOINED_ACTIVITY) {
              contextData.context = contextUpdatedMsg.context_snapshot || {};
          }
          else if (updatedMessageType === GW_MESSAGE_CONTEXT_UPDATED) {
              contextData.context = applyContextDelta(contextData.context, contextUpdatedMsg.delta, this._logger);
          }
          else {
              throw new Error("Unrecognized context update message " + updatedMessageType);
          }
          if (justSeen ||
              !deepEqual(contextData.context, oldContext) ||
              updatedMessageType === GW_MESSAGE_SUBSCRIBED_CONTEXT) {
              this.invokeUpdateCallbacks(contextData, contextUpdatedMsg.delta, { updaterId: contextUpdatedMsg.updater_id });
          }
      }
      invokeUpdateCallbacks(contextData, delta, extraData) {
          delta = delta || { added: {}, updated: {}, reset: {}, removed: [] };
          if (delta.commands) {
              delta.added = delta.updated = delta.reset = {};
              delta.removed = [];
              for (const command of delta.commands) {
                  if (command.type === "remove") {
                      if (command.path.indexOf(".") === -1) {
                          delta.removed.push(command.path);
                      }
                      setValueToPath(delta.updated, null, command.path);
                  }
                  else if (command.type === "set") {
                      setValueToPath(delta.updated, command.value, command.path);
                  }
              }
          }
          for (const updateCallbackIndex in contextData.updateCallbacks) {
              if (contextData.updateCallbacks.hasOwnProperty(updateCallbackIndex)) {
                  try {
                      const updateCallback = contextData.updateCallbacks[updateCallbackIndex];
                      updateCallback(deepClone(contextData.context), deepClone(Object.assign({}, delta.added || {}, delta.updated || {}, delta.reset || {})), delta.removed, parseInt(updateCallbackIndex, 10), extraData);
                  }
                  catch (err) {
                      this._logger.debug("callback error: " + JSON.stringify(err));
                  }
              }
          }
      }
      subscribeToContextDestroyedMessages() {
          const destroyedMessageTypes = [
              GW_MESSAGE_CONTEXT_DESTROYED,
              GW_MESSAGE_ACTIVITY_DESTROYED,
          ];
          for (const destroyedMessageType of destroyedMessageTypes) {
              const sub = this._connection.on(destroyedMessageType, this.handleContextDestroyedMessage.bind(this));
              this._gw3Subscriptions.push(sub);
          }
      }
      handleContextDestroyedMessage(destroyedMsg) {
          const destroyedMessageType = destroyedMsg.type;
          let contextId;
          let name;
          if (destroyedMessageType === GW_MESSAGE_ACTIVITY_DESTROYED) {
              name = destroyedMsg.activity_id;
              contextId = this._contextNameToId[name];
              if (!contextId) {
                  this._logger.error(`Received 'destroyed' for unknown activity: ${destroyedMsg.activity_id}`);
                  return;
              }
          }
          else {
              contextId = destroyedMsg.context_id;
              name = this._contextIdToName[contextId];
              if (!name) {
                  this._logger.error(`Received 'destroyed' for unknown context: ${destroyedMsg.context_id}`);
                  return;
              }
          }
          delete this._contextIdToName[contextId];
          delete this._contextNameToId[name];
          const contextData = this._contextNameToData[name];
          delete this._contextNameToData[name];
          if (!contextData || !contextData.isAnnounced) {
              this._logger.error(`Received 'destroyed' for unknown context: ${contextId}`);
              return;
          }
      }
      sendSubscribe(contextData) {
          contextData.sentExplicitSubscription = true;
          return this._gw3Session
              .send({
              type: GW_MESSAGE_SUBSCRIBE_CONTEXT,
              domain: "global",
              context_id: contextData.contextId,
          }).then((_) => undefined);
      }
      sendUnsubscribe(contextData) {
          contextData.sentExplicitSubscription = false;
          return this._gw3Session
              .send({
              type: GW_MESSAGE_UNSUBSCRIBE_CONTEXT,
              domain: "global",
              context_id: contextData.contextId,
          }).then((_) => undefined);
      }
      calculateContextDeltaV1(from, to) {
          const delta = { added: {}, updated: {}, removed: [], reset: undefined };
          if (from) {
              for (const x of Object.keys(from)) {
                  if (Object.keys(to).indexOf(x) !== -1
                      && to[x] !== null
                      && !deepEqual(from[x], to[x])) {
                      delta.updated[x] = to[x];
                  }
              }
          }
          for (const x of Object.keys(to)) {
              if (!from || (Object.keys(from).indexOf(x) === -1)) {
                  if (to[x] !== null) {
                      delta.added[x] = to[x];
                  }
              }
              else if (to[x] === null) {
                  delta.removed.push(x);
              }
          }
          return delta;
      }
      calculateContextDeltaV2(from, to) {
          const delta = { added: {}, updated: {}, removed: [], reset: undefined, commands: [] };
          for (const x of Object.keys(to)) {
              if (to[x] !== null) {
                  const fromX = from ? from[x] : null;
                  if (!deepEqual(fromX, to[x])) {
                      delta.commands?.push({ type: "set", path: x, value: to[x] });
                  }
              }
              else {
                  delta.commands?.push({ type: "remove", path: x });
              }
          }
          return delta;
      }
      resetState() {
          for (const sub of this._gw3Subscriptions) {
              this._connection.off(sub);
          }
          if (this._systemContextsSubKey) {
              this.unsubscribe(this._systemContextsSubKey);
              delete this._systemContextsSubKey;
          }
          this._gw3Subscriptions = [];
          this._contextNameToId = {};
          this._contextIdToName = {};
          delete this._protocolVersion;
          this._contextsTempCache = Object.keys(this._contextNameToData).reduce((cacheSoFar, ctxName) => {
              const contextData = this._contextNameToData[ctxName];
              if (contextData.isAnnounced && (contextData.activityId || contextData.sentExplicitSubscription)) {
                  cacheSoFar[ctxName] = this._contextNameToData[ctxName].context;
              }
              return cacheSoFar;
          }, {});
          this._contextNameToData = {};
      }
      async reInitiateState() {
          this.subscribeToContextCreatedMessages();
          this.subscribeToContextUpdatedMessages();
          this.subscribeToContextDestroyedMessages();
          this._connection.replayer?.drain(ContextMessageReplaySpec.name, (message) => {
              const type = message.type;
              if (!type) {
                  return;
              }
              if (type === GW_MESSAGE_CONTEXT_CREATED ||
                  type === GW_MESSAGE_CONTEXT_ADDED ||
                  type === GW_MESSAGE_ACTIVITY_CREATED) {
                  this.handleContextCreatedMessage(message);
              }
              else if (type === GW_MESSAGE_SUBSCRIBED_CONTEXT ||
                  type === GW_MESSAGE_CONTEXT_UPDATED ||
                  type === GW_MESSAGE_JOINED_ACTIVITY) {
                  this.handleContextUpdatedMessage(message);
              }
              else if (type === GW_MESSAGE_CONTEXT_DESTROYED ||
                  type === GW_MESSAGE_ACTIVITY_DESTROYED) {
                  this.handleContextDestroyedMessage(message);
              }
          });
          await Promise.all(this._contextsSubscriptionsCache.map((subscription) => this.subscribe(subscription.contextName, subscription.callback, subscription.subKey)));
          await this.flushQueue();
          for (const ctxName in this._contextsTempCache) {
              if (typeof this._contextsTempCache[ctxName] !== "object" || Object.keys(this._contextsTempCache[ctxName]).length === 0) {
                  continue;
              }
              const lastKnownData = this._contextsTempCache[ctxName];
              this._logger.info(`Re-announcing known context: ${ctxName}`);
              await this.flushQueue();
              await this.update(ctxName, lastKnownData);
          }
          this._contextsTempCache = {};
          this._logger.info("Contexts are re-announced");
      }
      flushQueue() {
          return new Promise((resolve) => setTimeout(() => resolve(), 0));
      }
  };

  class ContextsModule {
      initTime;
      initStartTime;
      initEndTime;
      _bridge;
      constructor(config) {
          this._bridge = new GW3Bridge$1(config);
      }
      all() {
          return this._bridge.all();
      }
      update(name, data) {
          this.checkName(name);
          this.checkData(data);
          return this._bridge.update(name, data);
      }
      set(name, data) {
          this.checkName(name);
          this.checkData(data);
          return this._bridge.set(name, data);
      }
      setPath(name, path, data) {
          this.checkName(name);
          this.checkPath(path);
          const isTopLevelPath = path === "";
          if (isTopLevelPath) {
              this.checkData(data);
              return this.set(name, data);
          }
          return this._bridge.setPath(name, path, data);
      }
      setPaths(name, paths) {
          this.checkName(name);
          if (!Array.isArray(paths)) {
              throw new Error("Please provide the paths as an array of PathValues!");
          }
          for (const { path, value } of paths) {
              this.checkPath(path);
              const isTopLevelPath = path === "";
              if (isTopLevelPath) {
                  this.checkData(value);
              }
          }
          return this._bridge.setPaths(name, paths);
      }
      subscribe(name, callback) {
          this.checkName(name);
          if (typeof callback !== "function") {
              throw new Error("Please provide the callback as a function!");
          }
          return this._bridge
              .subscribe(name, (data, delta, removed, key, extraData) => callback(data, delta, removed, () => this._bridge.unsubscribe(key), extraData))
              .then((key) => () => {
              this._bridge.unsubscribe(key);
          });
      }
      get(name) {
          this.checkName(name);
          return this._bridge.get(name);
      }
      ready() {
          return Promise.resolve(this);
      }
      destroy(name) {
          this.checkName(name);
          return this._bridge.destroy(name);
      }
      get setPathSupported() {
          return this._bridge.setPathSupported;
      }
      checkName(name) {
          if (typeof name !== "string" || name === "") {
              throw new Error("Please provide the name as a non-empty string!");
          }
      }
      checkPath(path) {
          if (typeof path !== "string") {
              throw new Error("Please provide the path as a dot delimited string!");
          }
      }
      checkData(data) {
          if (typeof data !== "object") {
              throw new Error("Please provide the data as an object!");
          }
      }
  }

  function promisify$2 (promise, successCallback, errorCallback) {
      if (typeof successCallback !== "function" && typeof errorCallback !== "function") {
          return promise;
      }
      if (typeof successCallback !== "function") {
          successCallback = () => { };
      }
      else if (typeof errorCallback !== "function") {
          errorCallback = () => { };
      }
      return promise.then(successCallback, errorCallback);
  }

  function rejectAfter(ms = 0, promise, error) {
      let timeout;
      const clearTimeoutIfThere = () => {
          if (timeout) {
              clearTimeout(timeout);
          }
      };
      promise
          .then(() => {
          clearTimeoutIfThere();
      })
          .catch(() => {
          clearTimeoutIfThere();
      });
      return new Promise((resolve, reject) => {
          timeout = setTimeout(() => reject(error), ms);
      });
  }

  var InvokeStatus;
  (function (InvokeStatus) {
      InvokeStatus[InvokeStatus["Success"] = 0] = "Success";
      InvokeStatus[InvokeStatus["Error"] = 1] = "Error";
  })(InvokeStatus || (InvokeStatus = {}));
  class Client {
      protocol;
      repo;
      instance;
      configuration;
      constructor(protocol, repo, instance, configuration) {
          this.protocol = protocol;
          this.repo = repo;
          this.instance = instance;
          this.configuration = configuration;
      }
      subscribe(method, options, successCallback, errorCallback, existingSub) {
          const callProtocolSubscribe = (targetServers, stream, successProxy, errorProxy) => {
              options.methodResponseTimeout = options.methodResponseTimeout ?? options.waitTimeoutMs;
              this.protocol.client.subscribe(stream, options, targetServers, successProxy, errorProxy, existingSub);
          };
          const promise = new Promise((resolve, reject) => {
              const successProxy = (sub) => {
                  resolve(sub);
              };
              const errorProxy = (err) => {
                  reject(err);
              };
              if (!method) {
                  reject(`Method definition is required. Please, provide either a unique string for a method name or a “methodDefinition” object with a required “name” property.`);
                  return;
              }
              let methodDef;
              if (typeof method === "string") {
                  methodDef = { name: method };
              }
              else {
                  methodDef = method;
              }
              if (!methodDef.name) {
                  reject(`Method definition is required. Please, provide either a unique string for a method name or a “methodDefinition” object with a required “name” property.`);
                  return;
              }
              if (options === undefined) {
                  options = {};
              }
              let target = options.target;
              if (target === undefined) {
                  target = "best";
              }
              if (typeof target === "string" && target !== "all" && target !== "best") {
                  reject(new Error(`"${target}" is not a valid target. Valid targets are "all", "best", or an instance.`));
                  return;
              }
              if (options.methodResponseTimeout === undefined) {
                  options.methodResponseTimeout = options.method_response_timeout;
                  if (options.methodResponseTimeout === undefined) {
                      options.methodResponseTimeout = this.configuration.methodResponseTimeout;
                  }
              }
              if (options.waitTimeoutMs === undefined) {
                  options.waitTimeoutMs = options.wait_for_method_timeout;
                  if (options.waitTimeoutMs === undefined) {
                      options.waitTimeoutMs = this.configuration.waitTimeoutMs;
                  }
              }
              const delayStep = 500;
              let delayTillNow = 0;
              let currentServers = this.getServerMethodsByFilterAndTarget(methodDef, target);
              if (currentServers.length > 0) {
                  callProtocolSubscribe(currentServers, currentServers[0].methods[0], successProxy, errorProxy);
              }
              else {
                  const retry = () => {
                      if (!target || !(options.waitTimeoutMs)) {
                          return;
                      }
                      delayTillNow += delayStep;
                      currentServers = this.getServerMethodsByFilterAndTarget(methodDef, target);
                      if (currentServers.length > 0) {
                          const streamInfo = currentServers[0].methods[0];
                          callProtocolSubscribe(currentServers, streamInfo, successProxy, errorProxy);
                      }
                      else if (delayTillNow >= options.waitTimeoutMs) {
                          const def = typeof method === "string" ? { name: method } : method;
                          callProtocolSubscribe(currentServers, def, successProxy, errorProxy);
                      }
                      else {
                          setTimeout(retry, delayStep);
                      }
                  };
                  setTimeout(retry, delayStep);
              }
          });
          return promisify$2(promise, successCallback, errorCallback);
      }
      servers(methodFilter) {
          const filterCopy = methodFilter === undefined
              ? undefined
              : { ...methodFilter };
          return this.getServers(filterCopy).map((serverMethodMap) => {
              return serverMethodMap.server.instance;
          });
      }
      methods(methodFilter) {
          if (typeof methodFilter === "string") {
              methodFilter = { name: methodFilter };
          }
          else {
              methodFilter = { ...methodFilter };
          }
          return this.getMethods(methodFilter);
      }
      methodsForInstance(instance) {
          return this.getMethodsForInstance(instance);
      }
      methodAdded(callback) {
          return this.repo.onMethodAdded(callback);
      }
      methodRemoved(callback) {
          return this.repo.onMethodRemoved(callback);
      }
      serverAdded(callback) {
          return this.repo.onServerAdded(callback);
      }
      serverRemoved(callback) {
          return this.repo.onServerRemoved((server, reason) => {
              callback(server, reason);
          });
      }
      serverMethodAdded(callback) {
          return this.repo.onServerMethodAdded((server, method) => {
              callback({ server, method });
          });
      }
      serverMethodRemoved(callback) {
          return this.repo.onServerMethodRemoved((server, method) => {
              callback({ server, method });
          });
      }
      async invoke(methodFilter, argumentObj, target, additionalOptions, success, error) {
          const getInvokePromise = async () => {
              let methodDefinition;
              if (typeof methodFilter === "string") {
                  methodDefinition = { name: methodFilter };
              }
              else {
                  methodDefinition = { ...methodFilter };
              }
              if (!methodDefinition.name) {
                  return Promise.reject(`Method definition is required. Please, provide either a unique string for a method name or a “methodDefinition” object with a required “name” property.`);
              }
              if (!argumentObj) {
                  argumentObj = {};
              }
              if (!target) {
                  target = "best";
              }
              if (typeof target === "string" && target !== "all" && target !== "best" && target !== "skipMine") {
                  return Promise.reject(new Error(`"${target}" is not a valid target. Valid targets are "all" and "best".`));
              }
              if (!additionalOptions) {
                  additionalOptions = {};
              }
              if (additionalOptions.methodResponseTimeoutMs === undefined) {
                  additionalOptions.methodResponseTimeoutMs = additionalOptions.method_response_timeout;
                  if (additionalOptions.methodResponseTimeoutMs === undefined) {
                      additionalOptions.methodResponseTimeoutMs = this.configuration.methodResponseTimeout;
                  }
              }
              if (additionalOptions.waitTimeoutMs === undefined) {
                  additionalOptions.waitTimeoutMs = additionalOptions.wait_for_method_timeout;
                  if (additionalOptions.waitTimeoutMs === undefined) {
                      additionalOptions.waitTimeoutMs = this.configuration.waitTimeoutMs;
                  }
              }
              if (additionalOptions.waitTimeoutMs !== undefined && typeof additionalOptions.waitTimeoutMs !== "number") {
                  return Promise.reject(new Error(`"${additionalOptions.waitTimeoutMs}" is not a valid number for "waitTimeoutMs" `));
              }
              if (typeof argumentObj !== "object") {
                  return Promise.reject(new Error(`The method arguments must be an object. method: ${methodDefinition.name}`));
              }
              let serversMethodMap = this.getServerMethodsByFilterAndTarget(methodDefinition, target);
              if (serversMethodMap.length === 0) {
                  try {
                      serversMethodMap = await this.tryToAwaitForMethods(methodDefinition, target, additionalOptions);
                  }
                  catch (err) {
                      const method = {
                          ...methodDefinition,
                          getServers: () => [],
                          supportsStreaming: false,
                          objectTypes: methodDefinition.objectTypes ?? [],
                          flags: methodDefinition.flags?.metadata ?? {}
                      };
                      const errorObj = {
                          method,
                          called_with: argumentObj,
                          message: `Can not find a method matching ${JSON.stringify(methodFilter)} with server filter ${JSON.stringify(target)}`,
                          executed_by: undefined,
                          returned: undefined,
                          status: undefined,
                      };
                      return Promise.reject(errorObj);
                  }
              }
              const timeout = additionalOptions.methodResponseTimeoutMs;
              const additionalOptionsCopy = additionalOptions;
              const invokePromises = serversMethodMap.map((serversMethodPair) => {
                  const invId = nanoid$1(10);
                  const method = serversMethodPair.methods[0];
                  const server = serversMethodPair.server;
                  const invokePromise = this.protocol.client.invoke(invId, method, argumentObj, server, additionalOptionsCopy);
                  return Promise.race([
                      invokePromise,
                      rejectAfter(timeout, invokePromise, {
                          invocationId: invId,
                          message: `Invocation timeout (${timeout} ms) reached for method name: ${method?.name}, target instance: ${JSON.stringify(server.instance)}, options: ${JSON.stringify(additionalOptionsCopy)}`,
                          status: InvokeStatus.Error,
                      })
                  ]);
              });
              const invocationMessages = await Promise.all(invokePromises);
              const results = this.getInvocationResultObj(invocationMessages, methodDefinition, argumentObj);
              const allRejected = invocationMessages.every((result) => result.status === InvokeStatus.Error);
              if (allRejected) {
                  return Promise.reject(results);
              }
              return results;
          };
          return promisify$2(getInvokePromise(), success, error);
      }
      getInvocationResultObj(invocationResults, method, calledWith) {
          const all_return_values = invocationResults
              .filter((invokeMessage) => invokeMessage.status === InvokeStatus.Success)
              .reduce((allValues, currentValue) => {
              allValues = [
                  ...allValues,
                  {
                      executed_by: currentValue.instance,
                      returned: currentValue.result,
                      called_with: calledWith,
                      method,
                      message: currentValue.message,
                      status: currentValue.status,
                  }
              ];
              return allValues;
          }, []);
          const all_errors = invocationResults
              .filter((invokeMessage) => invokeMessage.status === InvokeStatus.Error)
              .reduce((allErrors, currError) => {
              allErrors = [
                  ...allErrors,
                  {
                      executed_by: currError.instance,
                      called_with: calledWith,
                      name: method.name,
                      message: currError.message,
                  }
              ];
              return allErrors;
          }, []);
          const invResult = invocationResults[0];
          const result = {
              method,
              called_with: calledWith,
              returned: invResult.result,
              executed_by: invResult.instance,
              all_return_values,
              all_errors,
              message: invResult.message,
              status: invResult.status
          };
          return result;
      }
      tryToAwaitForMethods(methodDefinition, target, additionalOptions) {
          return new Promise((resolve, reject) => {
              if (additionalOptions.waitTimeoutMs === 0) {
                  reject();
                  return;
              }
              const delayStep = 500;
              let delayTillNow = 0;
              const retry = () => {
                  delayTillNow += delayStep;
                  const serversMethodMap = this.getServerMethodsByFilterAndTarget(methodDefinition, target);
                  if (serversMethodMap.length > 0) {
                      clearInterval(interval);
                      resolve(serversMethodMap);
                  }
                  else if (delayTillNow >= (additionalOptions.waitTimeoutMs || 10000)) {
                      clearInterval(interval);
                      reject();
                      return;
                  }
              };
              const interval = setInterval(retry, delayStep);
          });
      }
      filterByTarget(target, serverMethodMap) {
          if (typeof target === "string") {
              if (target === "all") {
                  return [...serverMethodMap];
              }
              else if (target === "best") {
                  const localMachine = serverMethodMap
                      .find((s) => s.server.instance.isLocal);
                  if (localMachine) {
                      return [localMachine];
                  }
                  if (serverMethodMap[0] !== undefined) {
                      return [serverMethodMap[0]];
                  }
              }
              else if (target === "skipMine") {
                  return serverMethodMap.filter(({ server }) => server.instance.peerId !== this.instance.peerId);
              }
          }
          else {
              let targetArray;
              if (!Array.isArray(target)) {
                  targetArray = [target];
              }
              else {
                  targetArray = target;
              }
              const allServersMatching = targetArray.reduce((matches, filter) => {
                  const myMatches = serverMethodMap.filter((serverMethodPair) => {
                      return this.instanceMatch(filter, serverMethodPair.server.instance);
                  });
                  return matches.concat(myMatches);
              }, []);
              return allServersMatching;
          }
          return [];
      }
      instanceMatch(instanceFilter, instanceDefinition) {
          if (instanceFilter?.peerId && instanceFilter?.instance) {
              instanceFilter = { ...instanceFilter };
              delete instanceFilter.peerId;
          }
          return this.containsProps(instanceFilter, instanceDefinition);
      }
      methodMatch(methodFilter, methodDefinition) {
          return this.containsProps(methodFilter, methodDefinition);
      }
      containsProps(filter, repoMethod) {
          const filterProps = Object.keys(filter)
              .filter((prop) => {
              return filter[prop] !== undefined
                  && filter[prop] !== null
                  && typeof filter[prop] !== "function"
                  && prop !== "object_types"
                  && prop !== "display_name"
                  && prop !== "id"
                  && prop !== "gatewayId"
                  && prop !== "identifier"
                  && prop[0] !== "_";
          });
          return filterProps.every((prop) => {
              let isMatch;
              const filterValue = filter[prop];
              const repoMethodValue = repoMethod[prop];
              switch (prop) {
                  case "objectTypes":
                      isMatch = (filterValue || []).every((filterValueEl) => {
                          return (repoMethodValue || []).includes(filterValueEl);
                      });
                      break;
                  case "flags":
                      isMatch = isSubset(repoMethodValue || {}, filterValue || {});
                      break;
                  default:
                      isMatch = String(filterValue).toLowerCase() === String(repoMethodValue).toLowerCase();
              }
              return isMatch;
          });
      }
      getMethods(methodFilter) {
          if (methodFilter === undefined) {
              return this.repo.getMethods();
          }
          const methods = this.repo.getMethods().filter((method) => {
              return this.methodMatch(methodFilter, method);
          });
          return methods;
      }
      getMethodsForInstance(instanceFilter) {
          const allServers = this.repo.getServers();
          const matchingServers = allServers.filter((server) => {
              return this.instanceMatch(instanceFilter, server.instance);
          });
          if (matchingServers.length === 0) {
              return [];
          }
          let resultMethodsObject = {};
          if (matchingServers.length === 1) {
              resultMethodsObject = matchingServers[0].methods;
          }
          else {
              matchingServers.forEach((server) => {
                  Object.keys(server.methods).forEach((methodKey) => {
                      const method = server.methods[methodKey];
                      resultMethodsObject[method.identifier] = method;
                  });
              });
          }
          return Object.keys(resultMethodsObject)
              .map((key) => {
              return resultMethodsObject[key];
          });
      }
      getServers(methodFilter) {
          const servers = this.repo.getServers();
          if (methodFilter === undefined) {
              return servers.map((server) => {
                  return { server, methods: [] };
              });
          }
          return servers.reduce((prev, current) => {
              const methodsForServer = Object.values(current.methods);
              const matchingMethods = methodsForServer.filter((method) => {
                  return this.methodMatch(methodFilter, method);
              });
              if (matchingMethods.length > 0) {
                  prev.push({ server: current, methods: matchingMethods });
              }
              return prev;
          }, []);
      }
      getServerMethodsByFilterAndTarget(methodFilter, target) {
          const serversMethodMap = this.getServers(methodFilter);
          return this.filterByTarget(target, serversMethodMap);
      }
  }

  class ServerSubscription {
      protocol;
      repoMethod;
      subscription;
      constructor(protocol, repoMethod, subscription) {
          this.protocol = protocol;
          this.repoMethod = repoMethod;
          this.subscription = subscription;
      }
      get stream() {
          if (!this.repoMethod.stream) {
              throw new Error("no stream");
          }
          return this.repoMethod.stream;
      }
      get arguments() { return this.subscription.arguments || {}; }
      get branchKey() { return this.subscription.branchKey; }
      get instance() {
          if (!this.subscription.instance) {
              throw new Error("no instance");
          }
          return this.subscription.instance;
      }
      close() {
          this.protocol.server.closeSingleSubscription(this.repoMethod, this.subscription);
      }
      push(data) {
          this.protocol.server.pushDataToSingle(this.repoMethod, this.subscription, data);
      }
  }

  class Request {
      protocol;
      repoMethod;
      requestContext;
      arguments;
      instance;
      constructor(protocol, repoMethod, requestContext) {
          this.protocol = protocol;
          this.repoMethod = repoMethod;
          this.requestContext = requestContext;
          this.arguments = requestContext.arguments;
          this.instance = requestContext.instance;
      }
      accept() {
          this.protocol.server.acceptRequestOnBranch(this.requestContext, this.repoMethod, "");
      }
      acceptOnBranch(branch) {
          this.protocol.server.acceptRequestOnBranch(this.requestContext, this.repoMethod, branch);
      }
      reject(reason) {
          this.protocol.server.rejectRequest(this.requestContext, this.repoMethod, reason);
      }
  }

  let ServerStreaming$1 = class ServerStreaming {
      protocol;
      server;
      constructor(protocol, server) {
          this.protocol = protocol;
          this.server = server;
          protocol.server.onSubRequest((rc, rm) => this.handleSubRequest(rc, rm));
          protocol.server.onSubAdded((sub, rm) => this.handleSubAdded(sub, rm));
          protocol.server.onSubRemoved((sub, rm) => this.handleSubRemoved(sub, rm));
      }
      handleSubRequest(requestContext, repoMethod) {
          if (!(repoMethod &&
              repoMethod.streamCallbacks &&
              typeof repoMethod.streamCallbacks.subscriptionRequestHandler === "function")) {
              return;
          }
          const request = new Request(this.protocol, repoMethod, requestContext);
          repoMethod.streamCallbacks.subscriptionRequestHandler(request);
      }
      handleSubAdded(subscription, repoMethod) {
          if (!(repoMethod &&
              repoMethod.streamCallbacks &&
              typeof repoMethod.streamCallbacks.subscriptionAddedHandler === "function")) {
              return;
          }
          const sub = new ServerSubscription(this.protocol, repoMethod, subscription);
          repoMethod.streamCallbacks.subscriptionAddedHandler(sub);
      }
      handleSubRemoved(subscription, repoMethod) {
          if (!(repoMethod &&
              repoMethod.streamCallbacks &&
              typeof repoMethod.streamCallbacks.subscriptionRemovedHandler === "function")) {
              return;
          }
          const sub = new ServerSubscription(this.protocol, repoMethod, subscription);
          repoMethod.streamCallbacks.subscriptionRemovedHandler(sub);
      }
  };

  class ServerBranch {
      key;
      protocol;
      repoMethod;
      constructor(key, protocol, repoMethod) {
          this.key = key;
          this.protocol = protocol;
          this.repoMethod = repoMethod;
      }
      subscriptions() {
          const subList = this.protocol.server.getSubscriptionList(this.repoMethod, this.key);
          return subList.map((sub) => {
              return new ServerSubscription(this.protocol, this.repoMethod, sub);
          });
      }
      close() {
          this.protocol.server.closeAllSubscriptions(this.repoMethod, this.key);
      }
      push(data) {
          this.protocol.server.pushData(this.repoMethod, data, [this.key]);
      }
  }

  class ServerStream {
      _protocol;
      _repoMethod;
      _server;
      name;
      constructor(_protocol, _repoMethod, _server) {
          this._protocol = _protocol;
          this._repoMethod = _repoMethod;
          this._server = _server;
          this.name = this._repoMethod.definition.name;
      }
      branches(key) {
          const bList = this._protocol.server.getBranchList(this._repoMethod);
          if (key) {
              if (bList.indexOf(key) > -1) {
                  return new ServerBranch(key, this._protocol, this._repoMethod);
              }
              return undefined;
          }
          else {
              return bList.map((branchKey) => {
                  return new ServerBranch(branchKey, this._protocol, this._repoMethod);
              });
          }
      }
      branch(key) {
          return this.branches(key);
      }
      subscriptions() {
          const subList = this._protocol.server.getSubscriptionList(this._repoMethod);
          return subList.map((sub) => {
              return new ServerSubscription(this._protocol, this._repoMethod, sub);
          });
      }
      get definition() {
          const def2 = this._repoMethod.definition;
          return {
              accepts: def2.accepts,
              description: def2.description,
              displayName: def2.displayName,
              name: def2.name,
              objectTypes: def2.objectTypes,
              returns: def2.returns,
              supportsStreaming: def2.supportsStreaming,
              flags: def2.flags?.metadata,
          };
      }
      close() {
          this._protocol.server.closeAllSubscriptions(this._repoMethod);
          this._server.unregister(this._repoMethod.definition, true);
      }
      push(data, branches) {
          if (typeof branches !== "string" && !Array.isArray(branches) && branches !== undefined) {
              throw new Error("invalid branches should be string or string array");
          }
          if (typeof data !== "object") {
              throw new Error("Invalid arguments. Data must be an object.");
          }
          this._protocol.server.pushData(this._repoMethod, data, branches);
      }
      updateRepoMethod(repoMethod) {
          this._repoMethod = repoMethod;
      }
  }

  class Server {
      protocol;
      serverRepository;
      streaming;
      invocations = 0;
      currentlyUnregistering = {};
      constructor(protocol, serverRepository) {
          this.protocol = protocol;
          this.serverRepository = serverRepository;
          this.streaming = new ServerStreaming$1(protocol, this);
          this.protocol.server.onInvoked(this.onMethodInvoked.bind(this));
      }
      createStream(streamDef, callbacks, successCallback, errorCallback, existingStream) {
          const promise = new Promise((resolve, reject) => {
              if (!streamDef) {
                  reject("The stream name must be unique! Please, provide either a unique string for a stream name to “glue.interop.createStream()” or a “methodDefinition” object with a unique “name” property for the stream.");
                  return;
              }
              let streamMethodDefinition;
              if (typeof streamDef === "string") {
                  streamMethodDefinition = { name: "" + streamDef };
              }
              else {
                  streamMethodDefinition = { ...streamDef };
              }
              if (!streamMethodDefinition.name) {
                  return reject(`The “name” property is required for the “streamDefinition” object and must be unique. Stream definition: ${JSON.stringify(streamMethodDefinition)}`);
              }
              const nameAlreadyExists = this.serverRepository.getList()
                  .some((serverMethod) => serverMethod.definition.name === streamMethodDefinition.name);
              if (nameAlreadyExists) {
                  return reject(`A stream with the name "${streamMethodDefinition.name}" already exists! Please, provide a unique name for the stream.`);
              }
              streamMethodDefinition.supportsStreaming = true;
              if (!callbacks) {
                  callbacks = {};
              }
              if (typeof callbacks.subscriptionRequestHandler !== "function") {
                  callbacks.subscriptionRequestHandler = (request) => {
                      request.accept();
                  };
              }
              const repoMethod = this.serverRepository.add({
                  definition: streamMethodDefinition,
                  streamCallbacks: callbacks,
                  protocolState: {},
              });
              this.protocol.server.createStream(repoMethod)
                  .then(() => {
                  let streamUserObject;
                  if (existingStream) {
                      streamUserObject = existingStream;
                      existingStream.updateRepoMethod(repoMethod);
                  }
                  else {
                      streamUserObject = new ServerStream(this.protocol, repoMethod, this);
                  }
                  repoMethod.stream = streamUserObject;
                  resolve(streamUserObject);
              })
                  .catch((err) => {
                  if (repoMethod.repoId) {
                      this.serverRepository.remove(repoMethod.repoId);
                  }
                  reject(err);
              });
          });
          return promisify$2(promise, successCallback, errorCallback);
      }
      register(methodDefinition, callback) {
          if (!methodDefinition) {
              return Promise.reject("Method definition is required. Please, provide either a unique string for a method name or a “methodDefinition” object with a required “name” property.");
          }
          if (typeof callback !== "function") {
              return Promise.reject(`The second parameter must be a callback function. Method: ${typeof methodDefinition === "string" ? methodDefinition : methodDefinition.name}`);
          }
          const wrappedCallbackFunction = async (context, resultCallback) => {
              try {
                  const result = callback(context.args, context.instance);
                  if (result && typeof result.then === "function") {
                      const resultValue = await result;
                      resultCallback(undefined, resultValue);
                  }
                  else {
                      resultCallback(undefined, result);
                  }
              }
              catch (e) {
                  resultCallback(e ?? "", e ?? "");
              }
          };
          wrappedCallbackFunction.userCallback = callback;
          return this.registerCore(methodDefinition, wrappedCallbackFunction);
      }
      registerAsync(methodDefinition, callback) {
          if (!methodDefinition) {
              return Promise.reject("Method definition is required. Please, provide either a unique string for a method name or a “methodDefinition” object with a required “name” property.");
          }
          if (typeof callback !== "function") {
              return Promise.reject(`The second parameter must be a callback function. Method: ${typeof methodDefinition === "string" ? methodDefinition : methodDefinition.name}`);
          }
          const wrappedCallback = async (context, resultCallback) => {
              try {
                  let resultCalled = false;
                  const success = (result) => {
                      if (!resultCalled) {
                          resultCallback(undefined, result);
                      }
                      resultCalled = true;
                  };
                  const error = (e) => {
                      if (!resultCalled) {
                          if (!e) {
                              e = "";
                          }
                          resultCallback(e, e);
                      }
                      resultCalled = true;
                  };
                  const methodResult = callback(context.args, context.instance, success, error);
                  if (methodResult && typeof methodResult.then === "function") {
                      methodResult
                          .then(success)
                          .catch(error);
                  }
              }
              catch (e) {
                  resultCallback(e, undefined);
              }
          };
          wrappedCallback.userCallbackAsync = callback;
          return this.registerCore(methodDefinition, wrappedCallback);
      }
      async unregister(methodFilter, forStream = false) {
          if (methodFilter === undefined) {
              return Promise.reject("Please, provide either a unique string for a name or an object containing a “name” property.");
          }
          if (typeof methodFilter === "function") {
              await this.unregisterWithPredicate(methodFilter, forStream);
              return;
          }
          let methodDefinition;
          if (typeof methodFilter === "string") {
              methodDefinition = { name: methodFilter };
          }
          else {
              methodDefinition = methodFilter;
          }
          if (methodDefinition.name === undefined) {
              return Promise.reject("Method name is required. Cannot find a method if the method name is undefined!");
          }
          const methodToBeRemoved = this.serverRepository.getList().find((serverMethod) => {
              return serverMethod.definition.name === methodDefinition.name
                  && (serverMethod.definition.supportsStreaming || false) === forStream;
          });
          if (!methodToBeRemoved) {
              return Promise.reject(`Method with a name "${methodDefinition.name}" does not exist or is not registered by your application!`);
          }
          await this.removeMethodsOrStreams([methodToBeRemoved]);
      }
      async unregisterWithPredicate(filterPredicate, forStream) {
          const methodsOrStreamsToRemove = this.serverRepository.getList()
              .filter((sm) => filterPredicate(sm.definition))
              .filter((serverMethod) => (serverMethod.definition.supportsStreaming || false) === forStream);
          if (!methodsOrStreamsToRemove || methodsOrStreamsToRemove.length === 0) {
              return Promise.reject(`Could not find a ${forStream ? "stream" : "method"} matching the specified condition!`);
          }
          await this.removeMethodsOrStreams(methodsOrStreamsToRemove);
      }
      removeMethodsOrStreams(methodsToRemove) {
          const methodUnregPromises = [];
          methodsToRemove.forEach((method) => {
              const promise = this.protocol.server.unregister(method)
                  .then(() => {
                  if (method.repoId) {
                      this.serverRepository.remove(method.repoId);
                  }
              });
              methodUnregPromises.push(promise);
              this.addAsCurrentlyUnregistering(method.definition.name, promise);
          });
          return Promise.all(methodUnregPromises);
      }
      async addAsCurrentlyUnregistering(methodName, promise) {
          const timeout = new Promise((resolve) => setTimeout(resolve, 5000));
          this.currentlyUnregistering[methodName] = Promise.race([promise, timeout]).then(() => {
              delete this.currentlyUnregistering[methodName];
          });
      }
      async registerCore(method, theFunction) {
          let methodDefinition;
          if (typeof method === "string") {
              methodDefinition = { name: "" + method };
          }
          else {
              methodDefinition = { ...method };
          }
          if (!methodDefinition.name) {
              return Promise.reject(`Please, provide a (unique) string value for the “name” property in the “methodDefinition” object: ${JSON.stringify(method)}`);
          }
          const unregisterInProgress = this.currentlyUnregistering[methodDefinition.name];
          if (typeof unregisterInProgress !== "undefined") {
              await unregisterInProgress;
          }
          const nameAlreadyExists = this.serverRepository.getList()
              .some((serverMethod) => serverMethod.definition.name === methodDefinition.name);
          if (nameAlreadyExists) {
              return Promise.reject(`A method with the name "${methodDefinition.name}" already exists! Please, provide a unique name for the method.`);
          }
          if (methodDefinition.supportsStreaming) {
              return Promise.reject(`When you create methods with “glue.interop.register()” or “glue.interop.registerAsync()” the property “supportsStreaming” cannot be “true”. If you want “${methodDefinition.name}” to be a stream, please use the “glue.interop.createStream()” method.`);
          }
          const repoMethod = this.serverRepository.add({
              definition: methodDefinition,
              theFunction,
              protocolState: {},
          });
          return this.protocol.server.register(repoMethod)
              .catch((err) => {
              if (repoMethod?.repoId) {
                  this.serverRepository.remove(repoMethod.repoId);
              }
              throw err;
          });
      }
      onMethodInvoked(methodToExecute, invocationId, invocationArgs) {
          if (!methodToExecute || !methodToExecute.theFunction) {
              return;
          }
          methodToExecute.theFunction(invocationArgs, (err, result) => {
              if (err !== undefined && err !== null) {
                  if (err.message && typeof err.message === "string") {
                      err = err.message;
                  }
                  else if (typeof err !== "string") {
                      try {
                          err = JSON.stringify(err);
                      }
                      catch (unStrException) {
                          err = `un-stringifyable error in onMethodInvoked! Top level prop names: ${Object.keys(err)}`;
                      }
                  }
              }
              if (!result) {
                  result = {};
              }
              else if (typeof result !== "object" || Array.isArray(result)) {
                  result = { _value: result };
              }
              this.protocol.server.methodInvocationResult(methodToExecute, invocationId, err, result);
          });
      }
  }

  class InstanceWrapper {
      wrapped = {};
      constructor(API, instance, connection) {
          this.wrapped.getMethods = function () {
              return API.methodsForInstance(this);
          };
          this.wrapped.getStreams = function () {
              return API.methodsForInstance(this).filter((m) => m.supportsStreaming);
          };
          if (instance) {
              this.refreshWrappedObject(instance);
          }
          if (connection) {
              connection.loggedIn(() => {
                  this.refresh(connection);
              });
              this.refresh(connection);
          }
      }
      unwrap() {
          return this.wrapped;
      }
      refresh(connection) {
          if (!connection) {
              return;
          }
          const resolvedIdentity = connection?.resolvedIdentity;
          const instance = Object.assign({}, resolvedIdentity ?? {}, { peerId: connection?.peerId });
          this.refreshWrappedObject(instance);
      }
      refreshWrappedObject(resolvedIdentity) {
          Object.keys(resolvedIdentity).forEach((key) => {
              this.wrapped[key] = resolvedIdentity[key];
          });
          this.wrapped.user = resolvedIdentity.user;
          this.wrapped.instance = resolvedIdentity.instance;
          this.wrapped.application = resolvedIdentity.application ?? nanoid$1(10);
          this.wrapped.applicationName = resolvedIdentity.applicationName;
          this.wrapped.pid = resolvedIdentity.pid ?? resolvedIdentity.process ?? Math.floor(Math.random() * 10000000000);
          this.wrapped.machine = resolvedIdentity.machine;
          this.wrapped.environment = resolvedIdentity.environment;
          this.wrapped.region = resolvedIdentity.region;
          this.wrapped.windowId = resolvedIdentity.windowId;
          this.wrapped.isLocal = resolvedIdentity.isLocal ?? true;
          this.wrapped.api = resolvedIdentity.api;
          this.wrapped.service = resolvedIdentity.service;
          this.wrapped.peerId = resolvedIdentity.peerId;
      }
  }

  const hideMethodSystemFlags = (method) => {
      return {
          ...method,
          flags: method.flags.metadata || {}
      };
  };
  class ClientRepository {
      logger;
      API;
      servers = {};
      myServer;
      methodsCount = {};
      callbacks = CallbackRegistryFactory$1();
      constructor(logger, API) {
          this.logger = logger;
          this.API = API;
          const peerId = this.API.instance.peerId;
          this.myServer = {
              id: peerId,
              methods: {},
              instance: this.API.instance,
              wrapper: this.API.unwrappedInstance,
          };
          this.servers[peerId] = this.myServer;
      }
      addServer(info, serverId) {
          this.logger.debug(`adding server ${serverId}`);
          const current = this.servers[serverId];
          if (current) {
              return current.id;
          }
          const wrapper = new InstanceWrapper(this.API, info);
          const serverEntry = {
              id: serverId,
              methods: {},
              instance: wrapper.unwrap(),
              wrapper,
          };
          this.servers[serverId] = serverEntry;
          this.callbacks.execute("onServerAdded", serverEntry.instance);
          return serverId;
      }
      removeServerById(id, reason) {
          const server = this.servers[id];
          if (!server) {
              this.logger.warn(`not aware of server ${id}, my state ${JSON.stringify(Object.keys(this.servers))}`);
              return;
          }
          else {
              this.logger.debug(`removing server ${id}`);
          }
          Object.keys(server.methods).forEach((methodId) => {
              this.removeServerMethod(id, methodId);
          });
          delete this.servers[id];
          this.callbacks.execute("onServerRemoved", server.instance, reason);
      }
      addServerMethod(serverId, method) {
          const server = this.servers[serverId];
          if (!server) {
              throw new Error("server does not exists");
          }
          if (server.methods[method.id]) {
              return;
          }
          const identifier = this.createMethodIdentifier(method);
          const that = this;
          const methodDefinition = {
              identifier,
              gatewayId: method.id,
              name: method.name,
              displayName: method.display_name,
              description: method.description,
              version: method.version,
              objectTypes: method.object_types || [],
              accepts: method.input_signature,
              returns: method.result_signature,
              supportsStreaming: typeof method.flags !== "undefined" ? method.flags.streaming : false,
              flags: method.flags ?? {},
              getServers: () => {
                  return that.getServersByMethod(identifier);
              }
          };
          methodDefinition.object_types = methodDefinition.objectTypes;
          methodDefinition.display_name = methodDefinition.displayName;
          methodDefinition.version = methodDefinition.version;
          server.methods[method.id] = methodDefinition;
          const clientMethodDefinition = hideMethodSystemFlags(methodDefinition);
          if (!this.methodsCount[identifier]) {
              this.methodsCount[identifier] = 0;
              this.callbacks.execute("onMethodAdded", clientMethodDefinition);
          }
          this.methodsCount[identifier] = this.methodsCount[identifier] + 1;
          this.callbacks.execute("onServerMethodAdded", server.instance, clientMethodDefinition);
          return methodDefinition;
      }
      removeServerMethod(serverId, methodId) {
          const server = this.servers[serverId];
          if (!server) {
              throw new Error("server does not exists");
          }
          const method = server.methods[methodId];
          delete server.methods[methodId];
          const clientMethodDefinition = hideMethodSystemFlags(method);
          this.methodsCount[method.identifier] = this.methodsCount[method.identifier] - 1;
          if (this.methodsCount[method.identifier] === 0) {
              this.callbacks.execute("onMethodRemoved", clientMethodDefinition);
          }
          this.callbacks.execute("onServerMethodRemoved", server.instance, clientMethodDefinition);
      }
      getMethods() {
          return this.extractMethodsFromServers(Object.values(this.servers)).map(hideMethodSystemFlags);
      }
      getServers() {
          return Object.values(this.servers).map(this.hideServerMethodSystemFlags);
      }
      onServerAdded(callback) {
          const unsubscribeFunc = this.callbacks.add("onServerAdded", callback);
          const serversWithMethodsToReplay = this.getServers().map((s) => s.instance);
          return this.returnUnsubWithDelayedReplay(unsubscribeFunc, serversWithMethodsToReplay, callback);
      }
      onMethodAdded(callback) {
          const unsubscribeFunc = this.callbacks.add("onMethodAdded", callback);
          const methodsToReplay = this.getMethods();
          return this.returnUnsubWithDelayedReplay(unsubscribeFunc, methodsToReplay, callback);
      }
      onServerMethodAdded(callback) {
          const unsubscribeFunc = this.callbacks.add("onServerMethodAdded", callback);
          let unsubCalled = false;
          const servers = this.getServers();
          setTimeout(() => {
              servers.forEach((server) => {
                  const methods = server.methods;
                  Object.keys(methods).forEach((methodId) => {
                      if (!unsubCalled) {
                          callback(server.instance, methods[methodId]);
                      }
                  });
              });
          }, 0);
          return () => {
              unsubCalled = true;
              unsubscribeFunc();
          };
      }
      onMethodRemoved(callback) {
          const unsubscribeFunc = this.callbacks.add("onMethodRemoved", callback);
          return unsubscribeFunc;
      }
      onServerRemoved(callback) {
          const unsubscribeFunc = this.callbacks.add("onServerRemoved", callback);
          return unsubscribeFunc;
      }
      onServerMethodRemoved(callback) {
          const unsubscribeFunc = this.callbacks.add("onServerMethodRemoved", callback);
          return unsubscribeFunc;
      }
      getServerById(id) {
          const server = this.servers[id];
          if (!server) {
              return undefined;
          }
          return this.hideServerMethodSystemFlags(this.servers[id]);
      }
      reset() {
          Object.keys(this.servers).forEach((key) => {
              this.removeServerById(key, "reset");
          });
          this.servers = {
              [this.myServer.id]: this.myServer
          };
          this.methodsCount = {};
      }
      createMethodIdentifier(methodInfo) {
          const accepts = methodInfo.input_signature ?? "";
          const returns = methodInfo.result_signature ?? "";
          return (methodInfo.name + accepts + returns).toLowerCase();
      }
      getServersByMethod(identifier) {
          const allServers = [];
          Object.values(this.servers).forEach((server) => {
              Object.values(server.methods).forEach((method) => {
                  if (method.identifier === identifier) {
                      allServers.push(server.instance);
                  }
              });
          });
          return allServers;
      }
      returnUnsubWithDelayedReplay(unsubscribeFunc, collectionToReplay, callback) {
          let unsubCalled = false;
          setTimeout(() => {
              collectionToReplay.forEach((item) => {
                  if (!unsubCalled) {
                      callback(item);
                  }
              });
          }, 0);
          return () => {
              unsubCalled = true;
              unsubscribeFunc();
          };
      }
      hideServerMethodSystemFlags(server) {
          const clientMethods = {};
          Object.entries(server.methods).forEach(([name, method]) => {
              clientMethods[name] = hideMethodSystemFlags(method);
          });
          return {
              ...server,
              methods: clientMethods
          };
      }
      extractMethodsFromServers(servers) {
          const methods = Object.values(servers).reduce((clientMethods, server) => {
              return [...clientMethods, ...Object.values(server.methods)];
          }, []);
          return methods;
      }
  }

  class ServerRepository {
      nextId = 0;
      methods = [];
      add(method) {
          method.repoId = String(this.nextId);
          this.nextId += 1;
          this.methods.push(method);
          return method;
      }
      remove(repoId) {
          if (typeof repoId !== "string") {
              return new TypeError("Expecting a string");
          }
          this.methods = this.methods.filter((m) => {
              return m.repoId !== repoId;
          });
      }
      getById(id) {
          if (typeof id !== "string") {
              return undefined;
          }
          return this.methods.find((m) => {
              return m.repoId === id;
          });
      }
      getList() {
          return this.methods.map((m) => m);
      }
      length() {
          return this.methods.length;
      }
      reset() {
          this.methods = [];
      }
  }

  const SUBSCRIPTION_REQUEST = "onSubscriptionRequest";
  const SUBSCRIPTION_ADDED = "onSubscriptionAdded";
  const SUBSCRIPTION_REMOVED = "onSubscriptionRemoved";
  class ServerStreaming {
      session;
      repository;
      serverRepository;
      ERR_URI_SUBSCRIPTION_FAILED = "com.tick42.agm.errors.subscription.failure";
      callbacks = CallbackRegistryFactory$1();
      nextStreamId = 0;
      constructor(session, repository, serverRepository) {
          this.session = session;
          this.repository = repository;
          this.serverRepository = serverRepository;
          session.on("add-interest", (msg) => {
              this.handleAddInterest(msg);
          });
          session.on("remove-interest", (msg) => {
              this.handleRemoveInterest(msg);
          });
      }
      acceptRequestOnBranch(requestContext, streamingMethod, branch) {
          if (typeof branch !== "string") {
              branch = "";
          }
          if (typeof streamingMethod.protocolState.subscriptionsMap !== "object") {
              throw new TypeError("The streaming method is missing its subscriptions.");
          }
          if (!Array.isArray(streamingMethod.protocolState.branchKeyToStreamIdMap)) {
              throw new TypeError("The streaming method is missing its branches.");
          }
          const streamId = this.getStreamId(streamingMethod, branch);
          const key = requestContext.msg.subscription_id;
          const subscription = {
              id: key,
              arguments: requestContext.arguments,
              instance: requestContext.instance,
              branchKey: branch,
              streamId,
              subscribeMsg: requestContext.msg,
          };
          streamingMethod.protocolState.subscriptionsMap[key] = subscription;
          this.session.sendFireAndForget({
              type: "accepted",
              subscription_id: key,
              stream_id: streamId,
          });
          this.callbacks.execute(SUBSCRIPTION_ADDED, subscription, streamingMethod);
      }
      rejectRequest(requestContext, streamingMethod, reason) {
          if (typeof reason !== "string") {
              reason = "";
          }
          this.sendSubscriptionFailed("Subscription rejected by user. " + reason, requestContext.msg.subscription_id);
      }
      pushData(streamingMethod, data, branches) {
          if (typeof streamingMethod !== "object" || !Array.isArray(streamingMethod.protocolState.branchKeyToStreamIdMap)) {
              return;
          }
          if (typeof data !== "object") {
              throw new Error("Invalid arguments. Data must be an object.");
          }
          if (typeof branches === "string") {
              branches = [branches];
          }
          else if (!Array.isArray(branches) || branches.length <= 0) {
              branches = [];
          }
          const streamIdList = streamingMethod.protocolState.branchKeyToStreamIdMap
              .filter((br) => {
              if (!branches || branches.length === 0) {
                  return true;
              }
              return branches.indexOf(br.key) >= 0;
          }).map((br) => {
              return br.streamId;
          });
          streamIdList.forEach((streamId) => {
              const publishMessage = {
                  type: "publish",
                  stream_id: streamId,
                  data,
              };
              this.session.sendFireAndForget(publishMessage);
          });
      }
      pushDataToSingle(method, subscription, data) {
          if (typeof data !== "object") {
              throw new Error("Invalid arguments. Data must be an object.");
          }
          const postMessage = {
              type: "post",
              subscription_id: subscription.id,
              data,
          };
          this.session.sendFireAndForget(postMessage);
      }
      closeSingleSubscription(streamingMethod, subscription) {
          if (streamingMethod.protocolState.subscriptionsMap) {
              delete streamingMethod.protocolState.subscriptionsMap[subscription.id];
          }
          const dropSubscriptionMessage = {
              type: "drop-subscription",
              subscription_id: subscription.id,
              reason: "Server dropping a single subscription",
          };
          this.session.sendFireAndForget(dropSubscriptionMessage);
          subscription.instance;
          this.callbacks.execute(SUBSCRIPTION_REMOVED, subscription, streamingMethod);
      }
      closeMultipleSubscriptions(streamingMethod, branchKey) {
          if (typeof streamingMethod !== "object" || typeof streamingMethod.protocolState.subscriptionsMap !== "object") {
              return;
          }
          if (!streamingMethod.protocolState.subscriptionsMap) {
              return;
          }
          const subscriptionsMap = streamingMethod.protocolState.subscriptionsMap;
          let subscriptionsToClose = Object.keys(subscriptionsMap)
              .map((key) => {
              return subscriptionsMap[key];
          });
          if (typeof branchKey === "string") {
              subscriptionsToClose = subscriptionsToClose.filter((sub) => {
                  return sub.branchKey === branchKey;
              });
          }
          subscriptionsToClose.forEach((subscription) => {
              delete subscriptionsMap[subscription.id];
              const drop = {
                  type: "drop-subscription",
                  subscription_id: subscription.id,
                  reason: "Server dropping all subscriptions on stream_id: " + subscription.streamId,
              };
              this.session.sendFireAndForget(drop);
          });
      }
      getSubscriptionList(streamingMethod, branchKey) {
          if (typeof streamingMethod !== "object") {
              return [];
          }
          let subscriptions = [];
          if (!streamingMethod.protocolState.subscriptionsMap) {
              return [];
          }
          const subscriptionsMap = streamingMethod.protocolState.subscriptionsMap;
          const allSubscriptions = Object.keys(subscriptionsMap)
              .map((key) => {
              return subscriptionsMap[key];
          });
          if (typeof branchKey !== "string") {
              subscriptions = allSubscriptions;
          }
          else {
              subscriptions = allSubscriptions.filter((sub) => {
                  return sub.branchKey === branchKey;
              });
          }
          return subscriptions;
      }
      getBranchList(streamingMethod) {
          if (typeof streamingMethod !== "object") {
              return [];
          }
          if (!streamingMethod.protocolState.subscriptionsMap) {
              return [];
          }
          const subscriptionsMap = streamingMethod.protocolState.subscriptionsMap;
          const allSubscriptions = Object.keys(subscriptionsMap)
              .map((key) => {
              return subscriptionsMap[key];
          });
          const result = [];
          allSubscriptions.forEach((sub) => {
              let branch = "";
              if (typeof sub === "object" && typeof sub.branchKey === "string") {
                  branch = sub.branchKey;
              }
              if (result.indexOf(branch) === -1) {
                  result.push(branch);
              }
          });
          return result;
      }
      onSubAdded(callback) {
          this.onSubscriptionLifetimeEvent(SUBSCRIPTION_ADDED, callback);
      }
      onSubRequest(callback) {
          this.onSubscriptionLifetimeEvent(SUBSCRIPTION_REQUEST, callback);
      }
      onSubRemoved(callback) {
          this.onSubscriptionLifetimeEvent(SUBSCRIPTION_REMOVED, callback);
      }
      handleRemoveInterest(msg) {
          const streamingMethod = this.serverRepository.getById(msg.method_id);
          if (typeof msg.subscription_id !== "string" ||
              typeof streamingMethod !== "object") {
              return;
          }
          if (!streamingMethod.protocolState.subscriptionsMap) {
              return;
          }
          if (typeof streamingMethod.protocolState.subscriptionsMap[msg.subscription_id] !== "object") {
              return;
          }
          const subscription = streamingMethod.protocolState.subscriptionsMap[msg.subscription_id];
          delete streamingMethod.protocolState.subscriptionsMap[msg.subscription_id];
          this.callbacks.execute(SUBSCRIPTION_REMOVED, subscription, streamingMethod);
      }
      onSubscriptionLifetimeEvent(eventName, handlerFunc) {
          this.callbacks.add(eventName, handlerFunc);
      }
      getNextStreamId() {
          return this.nextStreamId++ + "";
      }
      handleAddInterest(msg) {
          const caller = this.repository.getServerById(msg.caller_id);
          const instance = caller?.instance ?? {};
          const requestContext = {
              msg,
              arguments: msg.arguments_kv || {},
              instance,
          };
          const streamingMethod = this.serverRepository.getById(msg.method_id);
          if (streamingMethod === undefined) {
              const errorMsg = "No method with id " + msg.method_id + " on this server.";
              this.sendSubscriptionFailed(errorMsg, msg.subscription_id);
              return;
          }
          if (streamingMethod.protocolState.subscriptionsMap &&
              streamingMethod.protocolState.subscriptionsMap[msg.subscription_id]) {
              this.sendSubscriptionFailed("A subscription with id " + msg.subscription_id + " already exists.", msg.subscription_id);
              return;
          }
          this.callbacks.execute(SUBSCRIPTION_REQUEST, requestContext, streamingMethod);
      }
      sendSubscriptionFailed(reason, subscriptionId) {
          const errorMessage = {
              type: "error",
              reason_uri: this.ERR_URI_SUBSCRIPTION_FAILED,
              reason,
              request_id: subscriptionId,
          };
          this.session.sendFireAndForget(errorMessage);
      }
      getStreamId(streamingMethod, branchKey) {
          if (typeof branchKey !== "string") {
              branchKey = "";
          }
          if (!streamingMethod.protocolState.branchKeyToStreamIdMap) {
              throw new Error(`streaming ${streamingMethod.definition.name} method without protocol state`);
          }
          const needleBranch = streamingMethod.protocolState.branchKeyToStreamIdMap.filter((branch) => {
              return branch.key === branchKey;
          })[0];
          let streamId = (needleBranch ? needleBranch.streamId : undefined);
          if (typeof streamId !== "string" || streamId === "") {
              streamId = this.getNextStreamId();
              streamingMethod.protocolState.branchKeyToStreamIdMap.push({ key: branchKey, streamId });
          }
          return streamId;
      }
  }

  class ServerProtocol {
      session;
      clientRepository;
      serverRepository;
      logger;
      callbacks = CallbackRegistryFactory$1();
      streaming;
      constructor(session, clientRepository, serverRepository, logger) {
          this.session = session;
          this.clientRepository = clientRepository;
          this.serverRepository = serverRepository;
          this.logger = logger;
          this.streaming = new ServerStreaming(session, clientRepository, serverRepository);
          this.session.on("invoke", (msg) => this.handleInvokeMessage(msg));
      }
      createStream(repoMethod) {
          repoMethod.protocolState.subscriptionsMap = {};
          repoMethod.protocolState.branchKeyToStreamIdMap = [];
          return this.register(repoMethod, true);
      }
      register(repoMethod, isStreaming) {
          const methodDef = repoMethod.definition;
          const flags = Object.assign({}, { metadata: methodDef.flags ?? {} }, { streaming: isStreaming || false });
          const registerMsg = {
              type: "register",
              methods: [{
                      id: repoMethod.repoId,
                      name: methodDef.name,
                      display_name: methodDef.displayName,
                      description: methodDef.description,
                      version: methodDef.version,
                      flags,
                      object_types: methodDef.objectTypes || methodDef.object_types,
                      input_signature: methodDef.accepts,
                      result_signature: methodDef.returns,
                      restrictions: undefined,
                  }],
          };
          return this.session.send(registerMsg, { methodId: repoMethod.repoId })
              .then(() => {
              this.logger.debug("registered method " + repoMethod.definition.name + " with id " + repoMethod.repoId);
          })
              .catch((msg) => {
              this.logger.warn(`failed to register method ${repoMethod.definition.name} with id ${repoMethod.repoId} - ${JSON.stringify(msg)}`);
              throw msg;
          });
      }
      onInvoked(callback) {
          this.callbacks.add("onInvoked", callback);
      }
      methodInvocationResult(method, invocationId, err, result) {
          let msg;
          if (err || err === "") {
              msg = {
                  type: "error",
                  request_id: invocationId,
                  reason_uri: "agm.errors.client_error",
                  reason: err,
                  context: result,
                  peer_id: undefined,
              };
          }
          else {
              msg = {
                  type: "yield",
                  invocation_id: invocationId,
                  peer_id: this.session.peerId,
                  result,
                  request_id: undefined,
              };
          }
          this.session.sendFireAndForget(msg);
      }
      async unregister(method) {
          const msg = {
              type: "unregister",
              methods: [method.repoId],
          };
          await this.session.send(msg);
      }
      getBranchList(method) {
          return this.streaming.getBranchList(method);
      }
      getSubscriptionList(method, branchKey) {
          return this.streaming.getSubscriptionList(method, branchKey);
      }
      closeAllSubscriptions(method, branchKey) {
          this.streaming.closeMultipleSubscriptions(method, branchKey);
      }
      pushData(method, data, branches) {
          this.streaming.pushData(method, data, branches);
      }
      pushDataToSingle(method, subscription, data) {
          this.streaming.pushDataToSingle(method, subscription, data);
      }
      closeSingleSubscription(method, subscription) {
          this.streaming.closeSingleSubscription(method, subscription);
      }
      acceptRequestOnBranch(requestContext, method, branch) {
          this.streaming.acceptRequestOnBranch(requestContext, method, branch);
      }
      rejectRequest(requestContext, method, reason) {
          this.streaming.rejectRequest(requestContext, method, reason);
      }
      onSubRequest(callback) {
          this.streaming.onSubRequest(callback);
      }
      onSubAdded(callback) {
          this.streaming.onSubAdded(callback);
      }
      onSubRemoved(callback) {
          this.streaming.onSubRemoved(callback);
      }
      handleInvokeMessage(msg) {
          const invocationId = msg.invocation_id;
          const callerId = msg.caller_id;
          const methodId = msg.method_id;
          const args = msg.arguments_kv;
          const methodList = this.serverRepository.getList();
          const method = methodList.filter((m) => {
              return m.repoId === methodId;
          })[0];
          if (method === undefined) {
              return;
          }
          const client = this.clientRepository.getServerById(callerId)?.instance;
          const invocationArgs = { args, instance: client };
          this.callbacks.execute("onInvoked", method, invocationId, invocationArgs);
      }
  }

  class UserSubscription {
      repository;
      subscriptionData;
      get requestArguments() {
          return this.subscriptionData.params.arguments || {};
      }
      get servers() {
          return this.subscriptionData.trackedServers.reduce((servers, pair) => {
              if (pair.subscriptionId) {
                  const server = this.repository.getServerById(pair.serverId)?.instance;
                  if (server) {
                      servers.push(server);
                  }
              }
              return servers;
          }, []);
      }
      get serverInstance() {
          return this.servers[0];
      }
      get stream() {
          return this.subscriptionData.method;
      }
      constructor(repository, subscriptionData) {
          this.repository = repository;
          this.subscriptionData = subscriptionData;
      }
      onData(dataCallback) {
          if (typeof dataCallback !== "function") {
              throw new TypeError("The data callback must be a function.");
          }
          this.subscriptionData.handlers.onData.push(dataCallback);
          if (this.subscriptionData.handlers.onData.length === 1 && this.subscriptionData.queued.data.length > 0) {
              this.subscriptionData.queued.data.forEach((dataItem) => {
                  dataCallback(dataItem);
              });
          }
      }
      onClosed(closedCallback) {
          if (typeof closedCallback !== "function") {
              throw new TypeError("The callback must be a function.");
          }
          this.subscriptionData.handlers.onClosed.push(closedCallback);
      }
      onFailed(callback) {
      }
      onConnected(callback) {
          if (typeof callback !== "function") {
              throw new TypeError("The callback must be a function.");
          }
          this.subscriptionData.handlers.onConnected.push(callback);
      }
      close() {
          this.subscriptionData.close();
      }
      setNewSubscription(newSub) {
          this.subscriptionData = newSub;
      }
  }

  class TimedCache {
      config;
      cache = [];
      timeoutIds = [];
      constructor(config) {
          this.config = config;
      }
      add(element) {
          const id = nanoid$1(10);
          this.cache.push({ id, element });
          const timeoutId = setTimeout(() => {
              const elementIdx = this.cache.findIndex((entry) => entry.id === id);
              if (elementIdx < 0) {
                  return;
              }
              this.cache.splice(elementIdx, 1);
          }, this.config.ELEMENT_TTL_MS);
          this.timeoutIds.push(timeoutId);
      }
      flush() {
          const elements = this.cache.map((entry) => entry.element);
          this.timeoutIds.forEach((id) => clearInterval(id));
          this.cache = [];
          this.timeoutIds = [];
          return elements;
      }
  }

  const STATUS_AWAITING_ACCEPT = "awaitingAccept";
  const STATUS_SUBSCRIBED = "subscribed";
  const ERR_MSG_SUB_FAILED = "Subscription failed.";
  const ERR_MSG_SUB_REJECTED = "Subscription rejected.";
  const ON_CLOSE_MSG_SERVER_INIT = "ServerInitiated";
  const ON_CLOSE_MSG_CLIENT_INIT = "ClientInitiated";
  class ClientStreaming {
      session;
      repository;
      logger;
      subscriptionsList = {};
      timedCache = new TimedCache({ ELEMENT_TTL_MS: 10000 });
      subscriptionIdToLocalKeyMap = {};
      nextSubLocalKey = 0;
      constructor(session, repository, logger) {
          this.session = session;
          this.repository = repository;
          this.logger = logger;
          session.on("subscribed", this.handleSubscribed);
          session.on("event", this.handleEventData);
          session.on("subscription-cancelled", this.handleSubscriptionCancelled);
      }
      subscribe(streamingMethod, params, targetServers, success, error, existingSub) {
          if (targetServers.length === 0) {
              error({
                  method: streamingMethod,
                  called_with: params.arguments,
                  message: ERR_MSG_SUB_FAILED + " No available servers matched the target params.",
              });
              return;
          }
          const subLocalKey = this.getNextSubscriptionLocalKey();
          const pendingSub = this.registerSubscription(subLocalKey, streamingMethod, params, success, error, params.methodResponseTimeout || 10000, existingSub);
          if (typeof pendingSub !== "object") {
              error({
                  method: streamingMethod,
                  called_with: params.arguments,
                  message: ERR_MSG_SUB_FAILED + " Unable to register the user callbacks.",
              });
              return;
          }
          targetServers.forEach((target) => {
              const serverId = target.server.id;
              const method = target.methods.find((m) => m.name === streamingMethod.name);
              if (!method) {
                  this.logger.error(`can not find method ${streamingMethod.name} for target ${target.server.id}`);
                  return;
              }
              pendingSub.trackedServers.push({
                  serverId,
                  subscriptionId: undefined,
              });
              const msg = {
                  type: "subscribe",
                  server_id: serverId,
                  method_id: method.gatewayId,
                  arguments_kv: params.arguments,
              };
              this.session.send(msg, { serverId, subLocalKey })
                  .then((m) => this.handleSubscribed(m))
                  .catch((err) => this.handleErrorSubscribing(err));
          });
      }
      drainSubscriptions() {
          const existing = Object.values(this.subscriptionsList);
          this.subscriptionsList = {};
          this.subscriptionIdToLocalKeyMap = {};
          return existing;
      }
      drainSubscriptionsCache() {
          return this.timedCache.flush();
      }
      getNextSubscriptionLocalKey() {
          const current = this.nextSubLocalKey;
          this.nextSubLocalKey += 1;
          return current;
      }
      registerSubscription(subLocalKey, method, params, success, error, timeout, existingSub) {
          const subsInfo = {
              localKey: subLocalKey,
              status: STATUS_AWAITING_ACCEPT,
              method,
              params,
              success,
              error,
              trackedServers: [],
              handlers: {
                  onData: existingSub?.handlers.onData || [],
                  onClosed: existingSub?.handlers.onClosed || [],
                  onConnected: existingSub?.handlers.onConnected || [],
              },
              queued: {
                  data: [],
                  closers: [],
              },
              timeoutId: undefined,
              close: () => this.closeSubscription(subLocalKey),
              subscription: existingSub?.subscription
          };
          if (!existingSub) {
              if (params.onData) {
                  subsInfo.handlers.onData.push(params.onData);
              }
              if (params.onClosed) {
                  subsInfo.handlers.onClosed.push(params.onClosed);
              }
              if (params.onConnected) {
                  subsInfo.handlers.onConnected.push(params.onConnected);
              }
          }
          this.subscriptionsList[subLocalKey] = subsInfo;
          subsInfo.timeoutId = setTimeout(() => {
              if (this.subscriptionsList[subLocalKey] === undefined) {
                  return;
              }
              const pendingSub = this.subscriptionsList[subLocalKey];
              if (pendingSub.status === STATUS_AWAITING_ACCEPT) {
                  error({
                      method,
                      called_with: params.arguments,
                      message: ERR_MSG_SUB_FAILED + " Subscription attempt timed out after " + timeout + " ms.",
                  });
                  delete this.subscriptionsList[subLocalKey];
              }
              else if (pendingSub.status === STATUS_SUBSCRIBED && pendingSub.trackedServers.length > 0) {
                  pendingSub.trackedServers = pendingSub.trackedServers.filter((server) => {
                      return (typeof server.subscriptionId !== "undefined");
                  });
                  delete pendingSub.timeoutId;
                  if (pendingSub.trackedServers.length <= 0) {
                      this.callOnClosedHandlers(pendingSub);
                      delete this.subscriptionsList[subLocalKey];
                  }
              }
          }, timeout);
          return subsInfo;
      }
      handleErrorSubscribing = (errorResponse) => {
          const tag = errorResponse._tag;
          const subLocalKey = tag.subLocalKey;
          const pendingSub = this.subscriptionsList[subLocalKey];
          if (typeof pendingSub !== "object") {
              return;
          }
          pendingSub.trackedServers = pendingSub.trackedServers.filter((server) => {
              return server.serverId !== tag.serverId;
          });
          if (pendingSub.trackedServers.length <= 0) {
              clearTimeout(pendingSub.timeoutId);
              if (pendingSub.status === STATUS_AWAITING_ACCEPT) {
                  const reason = (typeof errorResponse.reason === "string" && errorResponse.reason !== "") ?
                      ' Publisher said "' + errorResponse.reason + '".' :
                      " No reason given.";
                  const callArgs = typeof pendingSub.params.arguments === "object" ?
                      JSON.stringify(pendingSub.params.arguments) :
                      "{}";
                  pendingSub.error({
                      message: ERR_MSG_SUB_REJECTED + reason + " Called with:" + callArgs,
                      called_with: pendingSub.params.arguments,
                      method: pendingSub.method,
                  });
              }
              else if (pendingSub.status === STATUS_SUBSCRIBED) {
                  this.callOnClosedHandlers(pendingSub);
              }
              delete this.subscriptionsList[subLocalKey];
          }
      };
      handleSubscribed = (msg) => {
          const subLocalKey = msg._tag.subLocalKey;
          const pendingSub = this.subscriptionsList[subLocalKey];
          if (typeof pendingSub !== "object") {
              return;
          }
          const serverId = msg._tag.serverId;
          const acceptingServer = pendingSub.trackedServers
              .filter((server) => {
              return server.serverId === serverId;
          })[0];
          if (typeof acceptingServer !== "object") {
              return;
          }
          acceptingServer.subscriptionId = msg.subscription_id;
          this.subscriptionIdToLocalKeyMap[msg.subscription_id] = subLocalKey;
          const isFirstResponse = (pendingSub.status === STATUS_AWAITING_ACCEPT);
          pendingSub.status = STATUS_SUBSCRIBED;
          if (isFirstResponse) {
              let reconnect = false;
              let sub = pendingSub.subscription;
              if (sub) {
                  sub.setNewSubscription(pendingSub);
                  pendingSub.success(sub);
                  reconnect = true;
              }
              else {
                  sub = new UserSubscription(this.repository, pendingSub);
                  pendingSub.subscription = sub;
                  pendingSub.success(sub);
              }
              for (const handler of pendingSub.handlers.onConnected) {
                  try {
                      handler(sub.serverInstance, reconnect);
                  }
                  catch (e) {
                  }
              }
          }
      };
      handleEventData = (msg) => {
          const subLocalKey = this.subscriptionIdToLocalKeyMap[msg.subscription_id];
          if (typeof subLocalKey === "undefined") {
              return;
          }
          const subscription = this.subscriptionsList[subLocalKey];
          if (typeof subscription !== "object") {
              return;
          }
          const trackedServersFound = subscription.trackedServers.filter((s) => {
              return s.subscriptionId === msg.subscription_id;
          });
          if (trackedServersFound.length !== 1) {
              return;
          }
          const isPrivateData = msg.oob;
          const sendingServerId = trackedServersFound[0].serverId;
          const server = this.repository.getServerById(sendingServerId);
          const receivedStreamData = () => {
              return {
                  data: msg.data,
                  server: server?.instance ?? {},
                  requestArguments: subscription.params.arguments,
                  message: undefined,
                  private: isPrivateData,
              };
          };
          const onDataHandlers = subscription.handlers.onData;
          const queuedData = subscription.queued.data;
          if (onDataHandlers.length > 0) {
              onDataHandlers.forEach((callback) => {
                  if (typeof callback === "function") {
                      callback(receivedStreamData());
                  }
              });
          }
          else {
              queuedData.push(receivedStreamData());
          }
      };
      handleSubscriptionCancelled = (msg) => {
          const subLocalKey = this.subscriptionIdToLocalKeyMap[msg.subscription_id];
          if (typeof subLocalKey === "undefined") {
              return;
          }
          const subscription = this.subscriptionsList[subLocalKey];
          if (typeof subscription !== "object") {
              return;
          }
          const expectedNewLength = subscription.trackedServers.length - 1;
          subscription.trackedServers = subscription.trackedServers.filter((server) => {
              if (server.subscriptionId === msg.subscription_id) {
                  subscription.queued.closers.push(server.serverId);
                  return false;
              }
              else {
                  return true;
              }
          });
          if (subscription.trackedServers.length !== expectedNewLength) {
              return;
          }
          if (subscription.trackedServers.length <= 0) {
              this.timedCache.add(subscription);
              clearTimeout(subscription.timeoutId);
              this.callOnClosedHandlers(subscription);
              delete this.subscriptionsList[subLocalKey];
          }
          delete this.subscriptionIdToLocalKeyMap[msg.subscription_id];
      };
      callOnClosedHandlers(subscription, reason) {
          const closersCount = subscription.queued.closers.length;
          const closingServerId = (closersCount > 0) ? subscription.queued.closers[closersCount - 1] : null;
          let closingServer;
          if (closingServerId !== undefined && typeof closingServerId === "string") {
              closingServer = this.repository.getServerById(closingServerId)?.instance ?? {};
          }
          subscription.handlers.onClosed.forEach((callback) => {
              if (typeof callback !== "function") {
                  return;
              }
              callback({
                  message: reason || ON_CLOSE_MSG_SERVER_INIT,
                  requestArguments: subscription.params.arguments || {},
                  server: closingServer,
                  stream: subscription.method,
              });
          });
      }
      closeSubscription(subLocalKey) {
          const subscription = this.subscriptionsList[subLocalKey];
          if (typeof subscription !== "object") {
              return;
          }
          subscription.trackedServers.forEach((server) => {
              if (typeof server.subscriptionId === "undefined") {
                  return;
              }
              subscription.queued.closers.push(server.serverId);
              this.session.sendFireAndForget({
                  type: "unsubscribe",
                  subscription_id: server.subscriptionId,
                  reason_uri: "",
                  reason: ON_CLOSE_MSG_CLIENT_INIT,
              });
              delete this.subscriptionIdToLocalKeyMap[server.subscriptionId];
          });
          subscription.trackedServers = [];
          this.callOnClosedHandlers(subscription, ON_CLOSE_MSG_CLIENT_INIT);
          delete this.subscriptionsList[subLocalKey];
      }
  }

  class ClientProtocol {
      session;
      repository;
      logger;
      streaming;
      constructor(session, repository, logger) {
          this.session = session;
          this.repository = repository;
          this.logger = logger;
          session.on("peer-added", (msg) => this.handlePeerAdded(msg));
          session.on("peer-removed", (msg) => this.handlePeerRemoved(msg));
          session.on("methods-added", (msg) => this.handleMethodsAddedMessage(msg));
          session.on("methods-removed", (msg) => this.handleMethodsRemovedMessage(msg));
          this.streaming = new ClientStreaming(session, repository, logger);
      }
      subscribe(stream, options, targetServers, success, error, existingSub) {
          this.streaming.subscribe(stream, options, targetServers, success, error, existingSub);
      }
      invoke(id, method, args, target) {
          const serverId = target.id;
          const methodId = method.gatewayId;
          const msg = {
              type: "call",
              server_id: serverId,
              method_id: methodId,
              arguments_kv: args,
          };
          return this.session.send(msg, { invocationId: id, serverId })
              .then((m) => this.handleResultMessage(m))
              .catch((err) => this.handleInvocationError(err));
      }
      drainSubscriptions() {
          return this.streaming.drainSubscriptions();
      }
      drainSubscriptionsCache() {
          return this.streaming.drainSubscriptionsCache();
      }
      handlePeerAdded(msg) {
          const newPeerId = msg.new_peer_id;
          const remoteId = msg.identity;
          const isLocal = msg.meta ? msg.meta.local : true;
          const pid = Number(remoteId.process);
          const serverInfo = {
              machine: remoteId.machine,
              pid: isNaN(pid) ? remoteId.process : pid,
              instance: remoteId.instance,
              application: remoteId.application,
              applicationName: remoteId.applicationName,
              environment: remoteId.environment,
              region: remoteId.region,
              user: remoteId.user,
              windowId: remoteId.windowId,
              peerId: newPeerId,
              api: remoteId.api,
              isLocal
          };
          this.repository.addServer(serverInfo, newPeerId);
      }
      handlePeerRemoved(msg) {
          const removedPeerId = msg.removed_id;
          const reason = msg.reason;
          this.repository.removeServerById(removedPeerId, reason);
      }
      handleMethodsAddedMessage(msg) {
          const serverId = msg.server_id;
          const methods = msg.methods;
          methods.forEach((method) => {
              this.repository.addServerMethod(serverId, method);
          });
      }
      handleMethodsRemovedMessage(msg) {
          const serverId = msg.server_id;
          const methodIdList = msg.methods;
          const server = this.repository.getServerById(serverId);
          if (server) {
              const serverMethodKeys = Object.keys(server.methods);
              serverMethodKeys.forEach((methodKey) => {
                  const method = server.methods[methodKey];
                  if (methodIdList.indexOf(method.gatewayId) > -1) {
                      this.repository.removeServerMethod(serverId, methodKey);
                  }
              });
          }
      }
      handleResultMessage(msg) {
          const invocationId = msg._tag.invocationId;
          const result = msg.result;
          const serverId = msg._tag.serverId;
          const server = this.repository.getServerById(serverId);
          return {
              invocationId,
              result,
              instance: server?.instance,
              status: InvokeStatus.Success,
              message: ""
          };
      }
      handleInvocationError(msg) {
          this.logger.debug(`handle invocation error ${JSON.stringify(msg)}`);
          if ("_tag" in msg) {
              const invocationId = msg._tag.invocationId;
              const serverId = msg._tag.serverId;
              const server = this.repository.getServerById(serverId);
              const message = msg.reason;
              const context = msg.context;
              return {
                  invocationId,
                  result: context,
                  instance: server?.instance,
                  status: InvokeStatus.Error,
                  message
              };
          }
          else {
              return {
                  invocationId: "",
                  message: msg.message,
                  status: InvokeStatus.Error,
                  error: msg
              };
          }
      }
  }

  function gW3ProtocolFactory (instance, connection, clientRepository, serverRepository, libConfig, interop) {
      const logger = libConfig.logger.subLogger("gw3-protocol");
      let resolveReadyPromise;
      const readyPromise = new Promise((resolve) => {
          resolveReadyPromise = resolve;
      });
      const session = connection.domain("agm", ["subscribed"]);
      const server = new ServerProtocol(session, clientRepository, serverRepository, logger.subLogger("server"));
      const client = new ClientProtocol(session, clientRepository, logger.subLogger("client"));
      async function handleReconnect() {
          logger.info("reconnected - will replay registered methods and subscriptions");
          client.drainSubscriptionsCache().forEach((sub) => {
              const methodInfo = sub.method;
              const params = Object.assign({}, sub.params);
              logger.info(`trying to soft-re-subscribe to method ${methodInfo.name}, with params: ${JSON.stringify(params)}`);
              interop.client.subscribe(methodInfo, params, undefined, undefined, sub).then(() => logger.info(`soft-subscribing to method ${methodInfo.name} DONE`)).catch((error) => logger.warn(`subscribing to method ${methodInfo.name} failed: ${JSON.stringify(error)}}`));
          });
          const reconnectionPromises = [];
          const existingSubscriptions = client.drainSubscriptions();
          for (const sub of existingSubscriptions) {
              const methodInfo = sub.method;
              const params = Object.assign({}, sub.params);
              logger.info(`trying to re-subscribe to method ${methodInfo.name}, with params: ${JSON.stringify(params)}`);
              reconnectionPromises.push(interop.client.subscribe(methodInfo, params, undefined, undefined, sub).then(() => logger.info(`subscribing to method ${methodInfo.name} DONE`)));
          }
          const registeredMethods = serverRepository.getList();
          serverRepository.reset();
          for (const method of registeredMethods) {
              const def = method.definition;
              if (method.stream) {
                  reconnectionPromises.push(interop.server.createStream(def, method.streamCallbacks, undefined, undefined, method.stream)
                      .then(() => logger.info(`subscribing to method ${def.name} DONE`))
                      .catch(() => logger.warn(`subscribing to method ${def.name} FAILED`)));
              }
              else if (method?.theFunction?.userCallback) {
                  reconnectionPromises.push(interop.register(def, method.theFunction.userCallback)
                      .then(() => logger.info(`registering method ${def.name} DONE`))
                      .catch(() => logger.warn(`registering method ${def.name} FAILED`)));
              }
              else if (method?.theFunction?.userCallbackAsync) {
                  reconnectionPromises.push(interop.registerAsync(def, method.theFunction.userCallbackAsync)
                      .then(() => logger.info(`registering method ${def.name} DONE`))
                      .catch(() => logger.warn(`registering method ${def.name} FAILED`)));
              }
          }
          await Promise.all(reconnectionPromises);
          logger.info("Interop is re-announced");
      }
      function handleInitialJoin() {
          if (resolveReadyPromise) {
              resolveReadyPromise({
                  client,
                  server,
              });
              resolveReadyPromise = undefined;
          }
      }
      session.onJoined((reconnect) => {
          clientRepository.addServer(instance, connection.peerId);
          if (reconnect) {
              handleReconnect().then(() => connection.setLibReAnnounced({ name: "interop" })).catch((error) => logger.warn(`Error while re-announcing interop: ${JSON.stringify(error)}`));
          }
          else {
              handleInitialJoin();
          }
      });
      session.onLeft(() => {
          clientRepository.reset();
      });
      session.join();
      return readyPromise;
  }

  class Interop {
      instance;
      readyPromise;
      client;
      server;
      unwrappedInstance;
      protocol;
      clientRepository;
      serverRepository;
      constructor(configuration) {
          if (typeof configuration === "undefined") {
              throw new Error("configuration is required");
          }
          if (typeof configuration.connection === "undefined") {
              throw new Error("configuration.connections is required");
          }
          const connection = configuration.connection;
          if (typeof configuration.methodResponseTimeout !== "number") {
              configuration.methodResponseTimeout = 30 * 1000;
          }
          if (typeof configuration.waitTimeoutMs !== "number") {
              configuration.waitTimeoutMs = 30 * 1000;
          }
          this.unwrappedInstance = new InstanceWrapper(this, undefined, connection);
          this.instance = this.unwrappedInstance.unwrap();
          this.clientRepository = new ClientRepository(configuration.logger.subLogger("cRep"), this);
          this.serverRepository = new ServerRepository();
          let protocolPromise;
          if (connection.protocolVersion === 3) {
              protocolPromise = gW3ProtocolFactory(this.instance, connection, this.clientRepository, this.serverRepository, configuration, this);
          }
          else {
              throw new Error(`protocol ${connection.protocolVersion} not supported`);
          }
          this.readyPromise = protocolPromise.then((protocol) => {
              this.protocol = protocol;
              this.client = new Client(this.protocol, this.clientRepository, this.instance, configuration);
              this.server = new Server(this.protocol, this.serverRepository);
              return this;
          });
      }
      ready() {
          return this.readyPromise;
      }
      serverRemoved(callback) {
          return this.client.serverRemoved(callback);
      }
      serverAdded(callback) {
          return this.client.serverAdded(callback);
      }
      serverMethodRemoved(callback) {
          return this.client.serverMethodRemoved(callback);
      }
      serverMethodAdded(callback) {
          return this.client.serverMethodAdded(callback);
      }
      methodRemoved(callback) {
          return this.client.methodRemoved(callback);
      }
      methodAdded(callback) {
          return this.client.methodAdded(callback);
      }
      methodsForInstance(instance) {
          return this.client.methodsForInstance(instance);
      }
      methods(methodFilter) {
          return this.client.methods(methodFilter);
      }
      servers(methodFilter) {
          return this.client.servers(methodFilter);
      }
      subscribe(method, options, successCallback, errorCallback) {
          return this.client.subscribe(method, options, successCallback, errorCallback);
      }
      createStream(streamDef, callbacks, successCallback, errorCallback) {
          return this.server.createStream(streamDef, callbacks, successCallback, errorCallback);
      }
      unregister(methodFilter) {
          return this.server.unregister(methodFilter);
      }
      registerAsync(methodDefinition, callback) {
          return this.server.registerAsync(methodDefinition, callback);
      }
      register(methodDefinition, callback) {
          return this.server.register(methodDefinition, callback);
      }
      invoke(methodFilter, argumentObj, target, additionalOptions, success, error) {
          return this.client.invoke(methodFilter, argumentObj, target, additionalOptions, success, error);
      }
      waitForMethod(name) {
          const pw = new PromiseWrapper$1();
          const unsubscribe = this.client.methodAdded((m) => {
              if (m.name === name) {
                  unsubscribe();
                  pw.resolve(m);
              }
          });
          return pw.promise;
      }
  }

  const successMessages = ["subscribed", "success"];
  class MessageBus {
      connection;
      logger;
      peerId;
      session;
      subscriptions;
      readyPromise;
      constructor(connection, logger) {
          this.connection = connection;
          this.logger = logger;
          this.peerId = connection.peerId;
          this.subscriptions = [];
          this.session = connection.domain("bus", successMessages);
          this.readyPromise = this.session.join();
          this.readyPromise.then(() => {
              this.watchOnEvent();
          });
      }
      ready() {
          return this.readyPromise;
      }
      publish = (topic, data, options) => {
          const { routingKey, target } = options || {};
          const args = this.removeEmptyValues({
              type: "publish",
              topic,
              data,
              peer_id: this.peerId,
              routing_key: routingKey,
              target_identity: target
          });
          this.session.send(args);
      };
      subscribe = (topic, callback, options) => {
          return new Promise((resolve, reject) => {
              const { routingKey, target } = options || {};
              const args = this.removeEmptyValues({
                  type: "subscribe",
                  topic,
                  peer_id: this.peerId,
                  routing_key: routingKey,
                  source: target
              });
              this.session.send(args)
                  .then((response) => {
                  const { subscription_id } = response;
                  this.subscriptions.push({ subscription_id, topic, callback, source: target });
                  resolve({
                      unsubscribe: () => {
                          this.session.send({ type: "unsubscribe", subscription_id, peer_id: this.peerId });
                          this.subscriptions = this.subscriptions.filter((s) => s.subscription_id !== subscription_id);
                          return Promise.resolve();
                      }
                  });
              })
                  .catch((error) => reject(error));
          });
      };
      watchOnEvent = () => {
          this.session.on("event", (args) => {
              const { data, subscription_id } = args;
              const source = args["publisher-identity"];
              const subscription = this.subscriptions.find((s) => s.subscription_id === subscription_id);
              if (subscription) {
                  if (!subscription.source) {
                      subscription.callback(data, subscription.topic, source);
                  }
                  else {
                      if (this.keysMatch(subscription.source, source)) {
                          subscription.callback(data, subscription.topic, source);
                      }
                  }
              }
          });
      };
      removeEmptyValues(obj) {
          const cleaned = {};
          Object.keys(obj).forEach((key) => {
              if (obj[key] !== undefined && obj[key] !== null) {
                  cleaned[key] = obj[key];
              }
          });
          return cleaned;
      }
      keysMatch(obj1, obj2) {
          const keysObj1 = Object.keys(obj1);
          let allMatch = true;
          keysObj1.forEach((key) => {
              if (obj1[key] !== obj2[key]) {
                  allMatch = false;
              }
          });
          return allMatch;
      }
  }

  const IOConnectCoreFactory = (userConfig, ext) => {
      const iodesktop = typeof window === "object" ? (window.iodesktop ?? window.glue42gd) : undefined;
      const preloadPromise = typeof window === "object" ? (window.gdPreloadPromise ?? Promise.resolve()) : Promise.resolve();
      const glueInitTimer = timer("glue");
      userConfig = userConfig || {};
      ext = ext || {};
      const internalConfig = prepareConfig$1(userConfig, ext, iodesktop);
      let _connection;
      let _interop;
      let _logger;
      let _metrics;
      let _contexts;
      let _bus;
      let _allowTrace;
      const libs = {};
      function registerLib(name, inner, t) {
          _allowTrace = _logger.canPublish("trace");
          if (_allowTrace) {
              _logger.trace(`registering ${name} module`);
          }
          const done = (e) => {
              inner.initTime = t.stop();
              inner.initEndTime = t.endTime;
              inner.marks = t.marks;
              if (!_allowTrace) {
                  return;
              }
              const traceMessage = e ?
                  `${name} failed - ${e.message}` :
                  `${name} is ready - ${t.endTime - t.startTime}`;
              _logger.trace(traceMessage);
          };
          inner.initStartTime = t.startTime;
          if (inner.ready) {
              inner.ready()
                  .then(() => {
                  done();
              })
                  .catch((e) => {
                  const error = typeof e === "string" ? new Error(e) : e;
                  done(error);
              });
          }
          else {
              done();
          }
          if (!Array.isArray(name)) {
              name = [name];
          }
          name.forEach((n) => {
              libs[n] = inner;
              IOConnectCoreFactory[n] = inner;
          });
      }
      function setupConnection() {
          const initTimer = timer("connection");
          _connection = new Connection(internalConfig.connection, _logger.subLogger("connection"));
          let authPromise = Promise.resolve(internalConfig.auth);
          if (internalConfig.connection && !internalConfig.auth) {
              if (iodesktop) {
                  authPromise = iodesktop.getGWToken()
                      .then((token) => {
                      return {
                          gatewayToken: token
                      };
                  });
              }
              else if (typeof window !== "undefined" && window?.glue42electron) {
                  if (typeof window.glue42electron.gwToken === "string") {
                      authPromise = Promise.resolve({
                          gatewayToken: window.glue42electron.gwToken
                      });
                  }
              }
              else {
                  authPromise = Promise.reject("You need to provide auth information");
              }
          }
          return authPromise
              .then((authConfig) => {
              initTimer.mark("auth-promise-resolved");
              let authRequest;
              if (Object.prototype.toString.call(authConfig) === "[object Object]") {
                  authRequest = authConfig;
              }
              else {
                  throw new Error("Invalid auth object - " + JSON.stringify(authConfig));
              }
              return _connection.login(authRequest);
          })
              .then(() => {
              registerLib("connection", _connection, initTimer);
              return internalConfig;
          })
              .catch((e) => {
              if (_connection) {
                  _connection.logout();
              }
              throw e;
          });
      }
      function setupLogger() {
          const initTimer = timer("logger");
          _logger = new Logger$1(`${internalConfig.connection.identity?.application}`, undefined, internalConfig.customLogger);
          _logger.consoleLevel(internalConfig.logger.console);
          _logger.publishLevel(internalConfig.logger.publish);
          if (_logger.canPublish("debug")) {
              _logger.debug("initializing glue...");
          }
          registerLib("logger", _logger, initTimer);
          return Promise.resolve(undefined);
      }
      function setupMetrics() {
          const initTimer = timer("metrics");
          const config = internalConfig.metrics;
          const metricsPublishingEnabledFunc = iodesktop?.getMetricsPublishingEnabled;
          const identity = internalConfig.connection.identity;
          const canUpdateMetric = metricsPublishingEnabledFunc ? metricsPublishingEnabledFunc : () => true;
          const disableAutoAppSystem = (typeof config !== "boolean" && config.disableAutoAppSystem) ?? false;
          _metrics = metrics({
              connection: config ? _connection : undefined,
              logger: _logger.subLogger("metrics"),
              canUpdateMetric,
              system: "Glue42",
              service: identity?.service ?? iodesktop?.applicationName ?? internalConfig.application,
              instance: identity?.instance ?? identity?.windowId ?? nanoid$1(10),
              disableAutoAppSystem,
              pagePerformanceMetrics: typeof config !== "boolean" ? config?.pagePerformanceMetrics : undefined
          });
          registerLib("metrics", _metrics, initTimer);
          return Promise.resolve();
      }
      function setupInterop() {
          const initTimer = timer("interop");
          const agmConfig = {
              connection: _connection,
              logger: _logger.subLogger("interop"),
          };
          _interop = new Interop(agmConfig);
          Logger$1.Interop = _interop;
          registerLib(["interop", "agm"], _interop, initTimer);
          return Promise.resolve();
      }
      function setupContexts() {
          const hasActivities = (internalConfig.activities && _connection.protocolVersion === 3);
          const needsContexts = internalConfig.contexts || hasActivities;
          if (needsContexts) {
              const initTimer = timer("contexts");
              _contexts = new ContextsModule({
                  connection: _connection,
                  logger: _logger.subLogger("contexts"),
                  trackAllContexts: typeof internalConfig.contexts === "object" ? internalConfig.contexts.trackAllContexts : false,
                  reAnnounceKnownContexts: typeof internalConfig.contexts === "object" ? internalConfig.contexts.reAnnounceKnownContexts : false
              });
              registerLib("contexts", _contexts, initTimer);
              return _contexts;
          }
          else {
              const replayer = _connection.replayer;
              if (replayer) {
                  replayer.drain(ContextMessageReplaySpec.name);
              }
          }
      }
      async function setupBus() {
          if (!internalConfig.bus) {
              return Promise.resolve();
          }
          const initTimer = timer("bus");
          _bus = new MessageBus(_connection, _logger.subLogger("bus"));
          registerLib("bus", _bus, initTimer);
          return Promise.resolve();
      }
      function setupExternalLibs(externalLibs) {
          try {
              externalLibs.forEach((lib) => {
                  setupExternalLib(lib.name, lib.create);
              });
              return Promise.resolve();
          }
          catch (e) {
              return Promise.reject(e);
          }
      }
      function setupExternalLib(name, createCallback) {
          const initTimer = timer(name);
          const lib = createCallback(libs);
          if (lib) {
              registerLib(name, lib, initTimer);
          }
      }
      function waitForLibs() {
          const libsReadyPromises = Object.keys(libs).map((key) => {
              const lib = libs[key];
              return lib.ready ?
                  lib.ready() : Promise.resolve();
          });
          return Promise.all(libsReadyPromises);
      }
      function constructGlueObject() {
          const feedbackFunc = (feedbackInfo) => {
              if (!_interop) {
                  return;
              }
              _interop.invoke("T42.ACS.Feedback", feedbackInfo, "best");
          };
          const info = {
              coreVersion: version$1,
              version: internalConfig.version
          };
          glueInitTimer.stop();
          const glue = {
              feedback: feedbackFunc,
              info,
              logger: _logger,
              interop: _interop,
              agm: _interop,
              connection: _connection,
              metrics: _metrics,
              contexts: _contexts,
              bus: _bus,
              version: internalConfig.version,
              userConfig,
              done: () => {
                  _logger?.info("done called by user...");
                  return _connection.logout();
              }
          };
          glue.performance = {
              get glueVer() {
                  return internalConfig.version;
              },
              get glueConfig() {
                  return JSON.stringify(userConfig);
              },
              get browser() {
                  return window.performance.timing.toJSON();
              },
              get memory() {
                  return window.performance.memory;
              },
              get initTimes() {
                  const all = getAllTimers();
                  return Object.keys(all).map((key) => {
                      const t = all[key];
                      return {
                          name: key,
                          duration: t.endTime - t.startTime,
                          marks: t.marks,
                          startTime: t.startTime,
                          endTime: t.endTime
                      };
                  });
              }
          };
          Object.keys(libs).forEach((key) => {
              const lib = libs[key];
              glue[key] = lib;
          });
          glue.config = {};
          Object.keys(internalConfig).forEach((k) => {
              glue.config[k] = internalConfig[k];
          });
          if (ext && ext.extOptions) {
              Object.keys(ext.extOptions).forEach((k) => {
                  glue.config[k] = ext?.extOptions[k];
              });
          }
          if (ext?.enrichGlue) {
              ext.enrichGlue(glue);
          }
          if (iodesktop && iodesktop.updatePerfData) {
              iodesktop.updatePerfData(glue.performance);
          }
          if (glue.agm) {
              const deprecatedDecorator = (fn, wrong, proper) => {
                  return function () {
                      glue.logger.warn(`glue.js - 'glue.agm.${wrong}' method is deprecated, use 'glue.interop.${proper}' instead.`);
                      return fn.apply(glue.agm, arguments);
                  };
              };
              const agmAny = glue.agm;
              agmAny.method_added = deprecatedDecorator(glue.agm.methodAdded, "method_added", "methodAdded");
              agmAny.method_removed = deprecatedDecorator(glue.agm.methodRemoved, "method_removed", "methodRemoved");
              agmAny.server_added = deprecatedDecorator(glue.agm.serverAdded, "server_added", "serverAdded");
              agmAny.server_method_aded = deprecatedDecorator(glue.agm.serverMethodAdded, "server_method_aded", "serverMethodAdded");
              agmAny.server_method_removed = deprecatedDecorator(glue.agm.serverMethodRemoved, "server_method_removed", "serverMethodRemoved");
          }
          return glue;
      }
      async function registerInstanceIfNeeded() {
          const RegisterInstanceMethodName = "T42.ACS.RegisterInstance";
          if (Utils$1.isNode() && typeof process.env._GD_STARTING_CONTEXT_ === "undefined" && typeof userConfig?.application !== "undefined") {
              const isMethodAvailable = _interop.methods({ name: RegisterInstanceMethodName }).length > 0;
              if (isMethodAvailable) {
                  try {
                      await _interop.invoke(RegisterInstanceMethodName, { appName: userConfig?.application, pid: process.pid });
                  }
                  catch (error) {
                      const typedError = error;
                      _logger.error(`Cannot register as an instance: ${JSON.stringify(typedError.message)}`);
                  }
              }
          }
      }
      return preloadPromise
          .then(setupLogger)
          .then(setupConnection)
          .then(() => Promise.all([setupMetrics(), setupInterop(), setupContexts(), setupBus()]))
          .then(() => _interop.readyPromise)
          .then(() => registerInstanceIfNeeded())
          .then(() => {
          return setupExternalLibs(internalConfig.libs || []);
      })
          .then(waitForLibs)
          .then(constructGlueObject)
          .catch((err) => {
          return Promise.reject({
              err,
              libs
          });
      });
  };
  if (typeof window !== "undefined") {
      window.IOConnectCore = IOConnectCoreFactory;
  }
  IOConnectCoreFactory.version = version$1;
  IOConnectCoreFactory.default = IOConnectCoreFactory;

  class ActivityEntity {
      constructor(id) {
          this._id = id;
      }
      get id() {
          return this._id;
      }
      _update(other) {
          if (other._id !== this._id) {
              throw Error("Can not update from entity with different id.");
          }
          this._updateCore(other);
      }
      _updateCore(other) {
          return;
      }
      _beforeDelete(other) {
          return;
      }
  }

  function isNumber(arg) {
      return typeof arg === "number";
  }
  function isString(arg) {
      return typeof arg === "string";
  }
  function isObject(arg) {
      return typeof arg === "object" && !Array.isArray(arg) && arg !== null;
  }
  function isArray(arg) {
      if (Array.isArray) {
          return Array.isArray(arg);
      }
      return toString.call(arg) === "[object Array]";
  }
  function isUndefined(arg) {
      return typeof arg === "undefined";
  }
  function isUndefinedOrNull(arg) {
      return arg === null || typeof arg === "undefined";
  }
  function isNullOrWhiteSpace(str) {
      return (typeof str !== "string" || !str || str.length === 0 || /^\s*$/.test(str));
  }
  function isBoolean(obj) {
      return obj === true || obj === false || toString.call(obj) === "[object Boolean]";
  }
  function isFunction(arg) {
      return !!(arg && arg.constructor && arg.call && arg.apply);
  }
  function some(array, predicate) {
      for (let index = 0; index < array.length; index++) {
          if (predicate(array[index], index)) {
              return true;
          }
      }
      return false;
  }
  function ifNotUndefined(what, doWithIt) {
      if (typeof what !== "undefined") {
          doWithIt(what);
      }
  }
  function promisify$1(promise, successCallback, errorCallback) {
      if (typeof successCallback !== "function" && typeof errorCallback !== "function") {
          return promise;
      }
      if (typeof successCallback !== "function") {
          successCallback = () => { return; };
      }
      else if (typeof errorCallback !== "function") {
          errorCallback = () => { return; };
      }
      promise.then(successCallback, errorCallback);
  }

  class ActivityType extends ActivityEntity {
      constructor(name, ownerWindow, helperWindows, description) {
          super(name);
          this._name = name;
          this._description = description;
          this._ownerWindow = ownerWindow;
          this._helperWindows = helperWindows || [];
      }
      get name() {
          return this._name;
      }
      get description() {
          return this._description;
      }
      get helperWindows() {
          return this._helperWindows.map((hw) => this.covertToWindowDef(hw));
      }
      get ownerWindow() {
          return this.covertToWindowDef(this._ownerWindow);
      }
      initiate(context, callback, configuration) {
          return this._manager.initiate(this._name, context, callback, configuration);
      }
      _updateCore(other) {
          super._updateCore(other);
          ifNotUndefined(other._description, (x) => this._description = x);
          ifNotUndefined(other._ownerWindow, (x) => this._ownerWindow = x);
          ifNotUndefined(other._helperWindows, (x) => this._helperWindows = x);
      }
      covertToWindowDef(windowType) {
          var _a, _b;
          return {
              type: (_a = windowType === null || windowType === void 0 ? void 0 : windowType.id) === null || _a === void 0 ? void 0 : _a.type,
              name: (_b = windowType === null || windowType === void 0 ? void 0 : windowType.id) === null || _b === void 0 ? void 0 : _b.name
          };
      }
  }

  class WindowType extends ActivityEntity {
      constructor(name, appByWindowTypeGetter) {
          super(name);
          this._name = name;
          this._appByWindowTypeGetter = appByWindowTypeGetter;
      }
      get name() {
          return this._name;
      }
      get config() {
          return this._appByWindowTypeGetter(this._name);
      }
      get windows() {
          return this._manager.getWindows({ type: this._name });
      }
      create(activity, configuration) {
          const definition = Object.assign({ type: this.name, name: this.name, isIndependent: false }, configuration);
          return this._manager.createWindow(activity, definition);
      }
  }

  class EntityEvent {
      constructor(entitiy, context) {
          this.entity = entitiy;
          this.context = context;
      }
  }
  class EntityEventContext {
      constructor(eventType) {
          this.type = eventType;
      }
  }
  class ActivityStatusChangeEventContext extends EntityEventContext {
      constructor(newStatus, oldStatus) {
          super(EntityEventType.StatusChange);
          this.newStatus = newStatus;
          this.oldStatus = oldStatus;
      }
  }
  class ActivityContextChangedEventContext extends EntityEventContext {
      constructor(context, updated, removed) {
          super(EntityEventType.ActivityContextChange);
          this.context = typeof context === "string" ? JSON.parse(context) : context;
          this.updated = updated;
          this.removed = removed;
      }
  }
  class EntityEventType {
  }
  EntityEventType.Added = "added";
  EntityEventType.Removed = "removed";
  EntityEventType.Updated = "updated";
  EntityEventType.Closed = "closed";
  EntityEventType.StatusChange = "statusChange";
  EntityEventType.ActivityContextChange = "activityContextUpdate";
  EntityEventType.ActivityWindowEvent = "activityWindowEvent";
  EntityEventType.ActivityWindowJoinedActivity = "joined";
  EntityEventType.ActivityWindowLeftActivity = "left";
  class ActivityState {
  }
  ActivityState.Created = "created";
  ActivityState.Started = "started";
  ActivityState.Destroyed = "destroyed";

  class ActivityAGM {
      constructor(activity) {
          this._activity = activity;
      }
      register(definition, handler) {
          this._ensureHasAgm();
          ActivityAGM.AGM.register(definition, handler);
      }
      servers() {
          this._ensureHasAgm();
          if (isUndefinedOrNull(this._activity)) {
              return [];
          }
          return this._activity.windows.map((w) => {
              return w.instance;
          });
      }
      methods() {
          this._ensureHasAgm();
          if (isUndefinedOrNull(this._activity)) {
              return [];
          }
          const windows = this._activity.windows;
          const methodNames = [];
          const methods = [];
          windows.forEach((window) => {
              const windowMethods = this.methodsForWindow(window);
              windowMethods.forEach((currentWindowMethod) => {
                  if (methodNames.indexOf(currentWindowMethod.name) === -1) {
                      methodNames.push(currentWindowMethod.name);
                      methods.push(currentWindowMethod);
                  }
              });
          });
          return methods;
      }
      methodsForWindow(window) {
          this._ensureHasAgm();
          if (!window.instance) {
              return [];
          }
          return ActivityAGM.AGM.methodsForInstance(window.instance);
      }
      invoke(methodName, arg, target, options, success, error) {
          this._ensureHasAgm();
          const activityServers = this.servers();
          if (isUndefinedOrNull(target)) {
              target = "activity.all";
          }
          if (isString(target)) {
              if (target === "activity.all") ;
              else if (target === "activity.best") {
                  const potentialTargets = activityServers.filter((server) => {
                      const methods = ActivityAGM.AGM.methodsForInstance(server);
                      return methods.filter((m) => {
                          return m.name === methodName;
                      }).length > 0;
                  });
                  if (potentialTargets.length > 0) {
                      [potentialTargets[0]];
                  }
              }
              else if (target === "all" || target === "best") {
                  return promisify$1(ActivityAGM.AGM.invoke(methodName, arg, target, options), success, error);
              }
              else {
                  throw new Error("Invalid invoke target " + target);
              }
          }
          else if (isArray(target)) {
              if (target.length >= 0) {
                  const firstElem = target[0];
                  if (this._isInstance(firstElem)) {
                      target.map((instance) => instance);
                  }
                  else if (this._isActivityWindow(firstElem)) {
                      target.map((win) => win.instance);
                  }
                  else {
                      throw new Error("Unknown target object");
                  }
              }
          }
          else {
              if (this._isInstance(target)) ;
              else if (this._isActivityWindow(target)) {
                  [target.instance];
              }
              else {
                  throw new Error("Unknown target object");
              }
          }
          throw new Error("Not implemented");
      }
      unregister(definition) {
          this._ensureHasAgm();
          return ActivityAGM.AGM.unregister(definition);
      }
      createStream(methodDefinition, subscriptionAddedHandler, subscriptionRemovedHandler) {
          this._ensureHasAgm();
          ActivityAGM.AGM.createStream(methodDefinition, {
              subscriptionAddedHandler,
              subscriptionRemovedHandler,
              subscriptionRequestHandler: undefined
          });
      }
      subscribe(methodDefinition, parameters, target) {
          this._ensureHasAgm();
          return ActivityAGM.AGM.subscribe(methodDefinition, parameters);
      }
      _ensureHasAgm() {
          if (isUndefinedOrNull(ActivityAGM.AGM)) {
              throw new Error("Agm should be configured to be used in activity");
          }
      }
      _isInstance(obj) {
          return obj.application !== undefined;
      }
      _isActivityWindow(obj) {
          return obj.instance !== undefined;
      }
  }

  class AttachedActivityDescriptor {
      constructor(manager, ownerActivityId, state) {
          this._manager = manager;
          this._ownerActivityId = ownerActivityId;
          this._state = state;
      }
      get ownerId() {
          return this._state.ownerId;
      }
      get windowIds() {
          return this._state.windowIds;
      }
      get frameColor() {
          return this._state.frameColor;
      }
      get context() {
          return this._state.context;
      }
      get tag() {
          return this._state.tag;
      }
      detach(descriptor) {
          descriptor = descriptor || {};
          const merged = {};
          Object.keys(this._state).forEach((prop) => {
              merged[prop] = this._state[prop];
          });
          merged.context = descriptor.context || merged.context;
          merged.frameColor = descriptor.frameColor || merged.frameColor;
          return this._manager.detachActivities(this._ownerActivityId, merged);
      }
  }

  const nextTick = (cb) => {
      setTimeout(cb, 0);
  };
  function nodeify(promise, callback) {
      if (!isFunction(callback)) {
          return promise;
      }
      promise.then((resp) => {
          nextTick(() => {
              callback(null, resp);
          });
      }, (err) => {
          nextTick(() => {
              callback(err, null);
          });
      });
  }

  class Activity extends ActivityEntity {
      constructor(id, actType, status, context, ownerId) {
          super(id);
          this._id = id;
          this._actType = actType;
          this._status = status;
          this._context = context;
          this._ownerId = ownerId;
          this._agm = new ActivityAGM(this);
      }
      get type() {
          if (this._manager) {
              return this._manager.getActivityType(this._actType);
          }
          return undefined;
      }
      get context() {
          return this._context;
      }
      get status() {
          return this._status;
      }
      get owner() {
          if (!this._ownerId) {
              return null;
          }
          return this._manager.getWindows({ id: this._ownerId })[0];
      }
      get windows() {
          return this._manager.getWindows({ activityId: this._id });
      }
      get agm() {
          return this._agm;
      }
      addWindow(window, callback) {
          return this._manager.addWindowToActivity(this, window, callback);
      }
      createWindow(windowType, callback) {
          return this._manager.createWindow(this, windowType, callback);
      }
      createStackedWindows(windowTypes, timeout, callback) {
          return this._manager.createStackedWindows(this, windowTypes, timeout, callback);
      }
      leave(window, callback) {
          return this._manager.leaveWindowFromActivity(this, window, callback);
      }
      getWindowsByType(windowType) {
          const filter = { activityId: this._id, type: windowType };
          return this._manager.getWindows(filter);
      }
      setContext(context, callback) {
          return this._manager.setActivityContext(this, context, callback);
      }
      updateContext(context, callback) {
          return this._manager.updateActivityContext(this, context, callback);
      }
      onStatusChange(handler) {
          return this._manager.subscribeActivityEvents((a, ns, os) => {
              if (a.id === this.id) {
                  handler(a, ns, os);
              }
          });
      }
      onWindowEvent(handler) {
          return this._manager.subscribeWindowEvents((a, w, e) => {
              if (a.id === this.id) {
                  handler(a, w, e);
              }
          });
      }
      onContextChanged(handler) {
          this._manager.subscribeActivityContextChanged((act, context, updated, removed) => {
              if (act.id === this.id) {
                  handler(context, updated, removed, act);
              }
          });
          try {
              handler(this.context, this.context, [], this);
          }
          catch (e) {
              return;
          }
      }
      stop() {
          this._manager.stopActivity(this);
      }
      clone(options) {
          return this._manager.clone(this, options);
      }
      attach(activity, tag) {
          let activityId;
          if (typeof activity === "string") {
              activityId = activity;
          }
          else {
              activityId = activity.id;
          }
          return this._manager.attachActivities(activityId, this.id, tag);
      }
      onActivityAttached(callback) {
          this._manager.subscribeActivitiesAttached((newActId, oldActId, descriptor) => {
              if (newActId !== this._id) {
                  return;
              }
              callback(descriptor);
          });
      }
      onDetached(callback) {
          this._manager.subscribeActivitiesDetached((newAct, originalActivity, state) => {
              if (originalActivity.id !== this._id) {
                  return;
              }
              callback(newAct, state);
          });
      }
      _updateCore(other) {
          super._updateCore(other);
          ifNotUndefined(other._actType, (x) => this._actType = x);
          ifNotUndefined(other._context, (x) => this._context = x);
          ifNotUndefined(other._ownerId, (x) => this._ownerId = x);
          if (other._status && (!this._status || (this._status.state !== other._status.state))) {
              this._status = other._status;
          }
      }
      _updateDescriptors(allStates) {
          this._attached = allStates.map((s) => {
              return new AttachedActivityDescriptor(this._manager, this._id, s);
          });
      }
      get attached() {
          return this._attached;
      }
      setFrameColor(color, callback) {
          const promise = new Promise((resolve, reject) => {
              let callbacksToWait = this.windows.length;
              if (callbacksToWait === 0) {
                  resolve(this);
              }
              this.windows.forEach((w) => {
                  w.underlyingWindow.setFrameColor(color, () => {
                      callbacksToWait--;
                      if (callbacksToWait <= 0) {
                          resolve(this);
                      }
                  });
              });
              setTimeout(() => {
                  if (callbacksToWait > 0) {
                      reject(this.id + " - timed out waiting for setFrameColor with" + color);
                  }
              }, 5000);
          });
          return nodeify(promise, callback);
      }
      getFrameColor() {
          if (!this.windows || this.windows.length === 0) {
              return "";
          }
          return this.windows[0].underlyingWindow.frameColor;
      }
  }

  class LogLevel {
  }
  LogLevel.Trace = "trace";
  LogLevel.Debug = "debug";
  LogLevel.Info = "info";
  LogLevel.Warn = "warn";
  LogLevel.Error = "error";
  class Logger {
      static GetNamed(name) {
          return new Logger(name);
      }
      static Get(owner) {
          return new Logger(Logger.GetTypeName(owner));
      }
      constructor(name) {
          this._name = name;
          if (!isUndefinedOrNull(Logger.GlueLogger)) {
              this._glueLogger = Logger.GlueLogger.subLogger(name);
          }
      }
      trace(message) {
          if (!isUndefinedOrNull(this._glueLogger)) {
              this._glueLogger.trace(message);
          }
          else {
              if (Logger.Level === LogLevel.Trace) {
                  console.info(this._getMessage(message, LogLevel.Trace));
              }
          }
      }
      debug(message) {
          if (!isUndefinedOrNull(this._glueLogger)) {
              this._glueLogger.debug(message);
          }
          else {
              if (Logger.Level === LogLevel.Debug ||
                  Logger.Level === LogLevel.Trace) {
                  console.info(this._getMessage(message, LogLevel.Debug));
              }
          }
      }
      info(message) {
          if (!isUndefinedOrNull(this._glueLogger)) {
              this._glueLogger.info(message);
          }
          else {
              if (Logger.Level === LogLevel.Debug ||
                  Logger.Level === LogLevel.Trace ||
                  Logger.Level === LogLevel.Info) {
                  console.info(this._getMessage(message, LogLevel.Info));
              }
          }
      }
      warn(message) {
          if (!isUndefinedOrNull(this._glueLogger)) {
              this._glueLogger.warn(message);
          }
          else {
              if (Logger.Level === LogLevel.Debug ||
                  Logger.Level === LogLevel.Trace ||
                  Logger.Level === LogLevel.Info ||
                  Logger.Level === LogLevel.Warn) {
                  console.info(this._getMessage(message, LogLevel.Info));
              }
          }
      }
      error(message) {
          if (!isUndefinedOrNull(this._glueLogger)) {
              this._glueLogger.error(message);
          }
          else {
              console.error(this._getMessage(message, LogLevel.Error));
              console.trace();
          }
      }
      _getMessage(message, level) {
          return "[" + level + "] " + this._name + " - " + message;
      }
      static GetTypeName(object) {
          const funcNameRegex = /function (.{1,})\(/;
          const results = (funcNameRegex).exec(object.constructor.toString());
          return (results && results.length > 1) ? results[1] : "";
      }
  }
  Logger.Level = LogLevel.Info;

  class ActivityWindow extends ActivityEntity {
      constructor(id, name, type, activityId, instance, isIndependent, windowGetter, hcWindowId) {
          super(id);
          this._logger = Logger.Get("window");
          this._type = type;
          this._activityId = activityId;
          this._name = name;
          this._instance = instance;
          this._isIndependent = isIndependent;
          this._windowGetter = windowGetter;
          this._hcWindowId = hcWindowId;
      }
      getBounds() {
          return this._manager.getWindowBounds(this.id);
      }
      get name() {
          return this._name;
      }
      get isIndependent() {
          return this._isIndependent;
      }
      get type() {
          if (this._manager) {
              return this._manager.getWindowType(this._type);
          }
          return undefined;
      }
      get activity() {
          if (isUndefined(this._activityId)) {
              return undefined;
          }
          return this._manager.getActivityById(this._activityId);
      }
      get isOwner() {
          const act = this.activity;
          if (isUndefined(act)) {
              return false;
          }
          return act.owner.id === this.id;
      }
      setVisible(isVisible, callback) {
          return this._manager.setWindowVisibility(this.id, isVisible);
      }
      activate(focus) {
          return this._manager.activateWindow(this.id, focus);
      }
      setBounds(bounds, callback) {
          return this._manager.setWindowBounds(this.id, bounds, callback);
      }
      close() {
          return this._manager.closeWindow(this.id);
      }
      get instance() {
          return this._instance;
      }
      get underlyingWindow() {
          const window = this._windowGetter();
          if (!window) {
              return {
                  id: this._hcWindowId
              };
          }
          return window;
      }
      onActivityJoined(callback) {
          this._subscribeForActivityWindowEvent(EntityEventType.ActivityWindowJoinedActivity, callback);
      }
      onActivityRemoved(callback) {
          this._subscribeForActivityWindowEvent(EntityEventType.ActivityWindowLeftActivity, callback);
      }
      _updateCore(other) {
          ifNotUndefined(other._activityId, (x) => this._activityId = x);
          ifNotUndefined(other._isIndependent, (x) => this._isIndependent = x);
          ifNotUndefined(other._hcWindowId, (x) => this._hcWindowId = x);
          ifNotUndefined(other._type, (x) => this._type = x);
          ifNotUndefined(other._name, (x) => this._name = x);
          if (!isUndefinedOrNull(other._instance)) {
              this._instance = other._instance;
          }
      }
      _subscribeForActivityWindowEvent(eventName, callback) {
          this._manager.subscribeWindowEvents((activity, window, event) => {
              if (window.id !== this.id) {
                  return;
              }
              if (event === eventName) {
                  callback(activity);
              }
          });
      }
      _beforeDelete(other) {
          this._hcWindowId = other._hcWindowId;
      }
  }

  class ActivityStatus {
      constructor(state, message, time) {
          this.state = state;
          this.message = message;
          this.time = time;
      }
      getState() {
          return this.state;
      }
      getMessage() {
          return this.message;
      }
      getTime() {
          return this.time;
      }
  }

  const gwMmessageError = "error";
  const gwMessageAddActivityTypes = "add-types";
  const gwMmessageActivityTypesAdded = "types-added";
  const gwMessageRemoveActivityTypes = "remove-types";
  const gwMessageActivityTypesRemoved = "types-removed";
  const gwMessageActivityCreated = "created";
  const gwMessageActivityDestroyed = "destroyed";
  const gwMessageActivityInitiated = "initiated";
  const gwMmessageJoinActivity = "join-activity";
  const gwMessageJoinedActivity = "joined";
  const gwMessageActivityJoined = "activity-joined";
  const gwMessageLeaveActivity = "leave-activity";
  const gwMessageActivityLeft = "left";
  const gwNmessageMergeActivities = "merge";
  const gwMessageSplitActivities = "split";
  const gwMessageOwnerChanged = "owner-changed";
  const gwMessageAddPeerFactories = "add-peer-factories";
  const gwMessagePeerFactoriesAdded = "peer-factories-added";
  const gwMessageRemovePeerFactories = "remove-peer-factories";
  const gwMessagePeerFactoriesRemoved = "peer-factories-removed";
  const gwMessageCreateActivity = "create";
  const gwMessageCreatePeer = "create-peer";
  const gwMessagePeerRequested = "peer-requested";
  const gwMessageReady = "ready";
  const gwMessagePeerCreated = "peer-created";
  const gwMessageDestroyActivity = "destroy";
  const gwMessageDisposePeer = "dispose-peer";
  const gwMessageDestroyPeer = "destroy-peer";
  class GW3Bridge {
      static activityTypeGwMessageEntityToActivityType(entity, description) {
          const nameToWindowType = (windowName) => new WindowType(windowName, undefined);
          return new ActivityType(entity.name, entity.owner_type && nameToWindowType(entity.owner_type), entity.helper_types && entity.helper_types.map(nameToWindowType), description);
      }
      static peerFactoryGwMessageEntityToWindowType(entity) {
          return new WindowType(entity.peer_type, (_) => undefined);
      }
      static activityGwMessageToActivity(msg, status) {
          const ownerId = msg.owner !== undefined ? msg.owner.peer_id : msg.owner_id;
          return new Activity(msg.activity_id, msg.activity_type, status, msg.context_snapshot, ownerId);
      }
      static activityToActivityStatusChangeEvent(act) {
          return new EntityEvent(act, new ActivityStatusChangeEventContext(act.status, undefined));
      }
      constructor(config) {
          this._activityChangeCallbacks = [];
          this._activityTypeStatusChangeCallbacks = [];
          this._activityWindowChangeCallbacks = [];
          this._windowTypeStatusChangeCallbacks = [];
          this._peerIdAndFactoryIdToPeerType = {};
          this._peerFactoriesRegisteredByUs = {};
          this._gw3Subscriptions = [];
          this._contextSubscriptions = {};
          this._activityTypesInitiatedFromMe = {};
          this._config = config;
          this._connection = config.connection;
          this._logger = config.logger;
          this._contexts = config.contexts;
          this._windows = config.windows;
          this._sessionJoinedPromise = new Promise((resolve) => {
              this._sessionJoinedPromiseResolve = resolve;
          });
          this._activityJoinedPromise = new Promise((resolve) => {
              this._activityJoinedPromiseResolve = resolve;
          });
          if (!this._config.activityId) {
              this._activityJoinedPromiseResolve({});
          }
          this._gw3Session = this._connection.domain("activity", ["joined", "initiated", "peer-created", "token"]);
          if (typeof window !== "undefined") {
              const glue42gd = (window).glue42gd;
              if (glue42gd && glue42gd.activityInfo) {
                  if (typeof glue42gd.addRefreshHandler === "function") {
                      glue42gd.addRefreshHandler((success, error) => {
                          this._gw3Session
                              .send({
                              type: "reload"
                          })
                              .then((msg) => {
                              if (!msg.token) {
                                  error("Expected gateway token for refreshing.");
                                  return;
                              }
                              try {
                                  glue42gd.setGWToken(msg.token);
                              }
                              catch (e) {
                                  error(e.message || e);
                                  return;
                              }
                              success();
                          }, error);
                      });
                  }
                  if (glue42gd && typeof glue42gd.addWillNavigateHandler === "function") {
                      glue42gd.addWillNavigateHandler((success, error) => {
                          this._gw3Session
                              .send({
                              type: "reload"
                          })
                              .then((msg) => {
                              if (!msg.token) {
                                  error("Expected gateway token for refreshing.");
                                  return;
                              }
                              try {
                                  glue42gd.setGWToken(msg.token);
                              }
                              catch (e) {
                                  error(e.message || e);
                                  return;
                              }
                              success();
                          }, error);
                      });
                  }
              }
          }
      }
      get bridgeType() {
          return "GW3";
      }
      init() {
          this.forwardActivityTypeMessagesToStatusEventHandlers();
          this.subscribe(gwMessageActivityCreated, this.handleActivityCreatedMessage);
          this.subscribe(gwMessageActivityDestroyed, this.handleActivityDestroyedMessage);
          this.forwardActivityMessagesToStatusEventHandlers();
          this.forwardActivityCreatedAndJoinedActivityToActivityWindowEventHandlers();
          this.forwardPeerFactoryMessagesToStatusEventHandlers();
          this.forwardPeerFactoryMessagesToPeerFactoryRequests();
          this.subscribe(gwMessagePeerFactoriesAdded, this.handlePeerFactoriesAdded);
          this.subscribe(gwMessagePeerFactoriesRemoved, this.handlePeerFactoriesRemoved);
          this.forwardActivityWindowMessagesToEventHandlers();
          this.subscribe(gwMessageDisposePeer, () => {
              if (this._config.disposeRequestHandling === "dispose") {
                  this.dispose();
                  return;
              }
              if (this._config.disposeRequestHandling === "exit") {
                  if (this._windows && typeof this._windows.my() !== "undefined") {
                      this._windows.my().close();
                      return;
                  }
                  if (typeof window !== "undefined" && typeof (window).close === "function") {
                      window.close();
                      return;
                  }
                  if (typeof process !== "undefined" && typeof (process).exit === "function") {
                      process.exit();
                      return;
                  }
              }
          });
          this._gw3Session.onJoined(() => {
              if (this._config.mode === "trackMyOnly" ||
                  this._config.mode === "trackMyTypeAndInitiatedFromMe") {
                  this._sessionJoinedPromiseResolve(this);
              }
              else {
                  this._gw3Session
                      .send({
                      type: "subscribe",
                      activity_types: (this._config.mode === "trackAll" ? [] :
                          this._config.mode === "trackTypes" ? this._config.typesToTrack : [])
                  })
                      .then(() => {
                      this._sessionJoinedPromiseResolve(this);
                  });
              }
          });
          this._gw3Session.join();
      }
      dispose() {
          this._gw3Subscriptions.forEach((sub) => sub && this._connection.off(sub));
          this._gw3Subscriptions.length = 0;
      }
      ready() {
          return Promise.all([this._sessionJoinedPromise, this._activityJoinedPromise]);
      }
      initReady() {
          return this._sessionJoinedPromise;
      }
      onActivityTypeStatusChange(callback) {
          this._activityTypeStatusChangeCallbacks.push(callback);
      }
      registerActivityType(activityTypeName, ownerWindow, helperWindows, config, description) {
          const entity = {};
          entity.name = activityTypeName;
          const toActivityPeerConfig = (windowDefinition) => ({ type: windowDefinition.type, name: windowDefinition.name, configuration: windowDefinition });
          entity.owner_type = toActivityPeerConfig(ownerWindow);
          entity.helper_types = helperWindows.map(toActivityPeerConfig);
          return this._gw3Session
              .send({
              type: gwMessageAddActivityTypes,
              types: [entity]
          })
              .then(() => {
              const activityType = GW3Bridge.activityTypeGwMessageEntityToActivityType(entity, description);
              this.invokeCallbacks(this._activityTypeStatusChangeCallbacks, new EntityEvent(activityType, new EntityEventContext(EntityEventType.Added)), gwMessageAddActivityTypes);
              return activityType;
          });
      }
      unregisterActivityType(activityTypeName) {
          return this._gw3Session
              .send({
              type: gwMessageRemoveActivityTypes,
              types: [activityTypeName]
          })
              .then(() => {
              const activityType = new ActivityType(activityTypeName, undefined, undefined, undefined);
              this.invokeCallbacks(this._activityTypeStatusChangeCallbacks, new EntityEvent(activityType, new EntityEventContext(EntityEventType.Removed)), gwMessageAddActivityTypes);
          });
      }
      onWindowTypeStatusChange(callback) {
          this._windowTypeStatusChangeCallbacks.push(callback);
      }
      registerWindowFactory(windowType, factory, parameters) {
          if (this._peerFactoriesRegisteredByUs[windowType]) {
              return Promise.reject(new Error(`Factory for windowType ${windowType} already registered.`));
          }
          this._peerFactoriesRegisteredByUs[windowType] = factory;
          const entity = {
              id: windowType,
              peer_type: windowType,
              configuration: parameters
          };
          return this._gw3Session.send({
              type: gwMessageAddPeerFactories,
              factories: [entity]
          })
              .then(() => {
              this.invokeCallbacks(this._windowTypeStatusChangeCallbacks, new EntityEvent(GW3Bridge.peerFactoryGwMessageEntityToWindowType(entity), new EntityEventContext(EntityEventType.Added)), gwMessageAddPeerFactories);
          })
              .catch(() => {
              delete this._peerFactoriesRegisteredByUs[windowType];
          });
      }
      unregisterWindowFactory(windowType) {
          const factory = this._peerFactoriesRegisteredByUs[windowType];
          if (!factory) {
              return Promise.reject(new Error(`Factory for windowType ${windowType} not registered.`));
          }
          delete this._peerFactoriesRegisteredByUs[windowType];
          return this._gw3Session.send({
              type: gwMessageRemovePeerFactories,
              factory_ids: [windowType]
          }).then(() => {
              this.invokeCallbacks(this._windowTypeStatusChangeCallbacks, new EntityEvent(new WindowType(windowType, undefined), new EntityEventContext(EntityEventType.Removed)), gwMessageAddPeerFactories);
          });
      }
      onActivityStatusChange(callback) {
          this._activityChangeCallbacks.push(callback);
      }
      initiateActivity(activityType, context, configuration) {
          const initiateMsg = {
              type: gwMessageCreateActivity,
              activity_type: activityType,
              initial_context: context,
          };
          if (this.isOverrideTypeDefinition(configuration)) {
              initiateMsg.types_override = {
                  owner_type: { type: configuration.owner.type, name: configuration.owner.name, configuration: configuration.owner },
                  helper_types: configuration.helpers && configuration.helpers.map((wd) => ({ type: wd.type, name: wd.name, configuration: wd }))
              };
          }
          else {
              initiateMsg.configuration = configuration && configuration.map((wd) => ({ type: wd.type, name: wd.name, configuration: wd }));
          }
          return this.sendCreateAndMapResultingMessagesToPromise(initiateMsg, gwMessageActivityInitiated, (msg, requestId) => msg.request_id === requestId, gwMessageActivityCreated, (msg, requestId, initMsg) => msg.activity_id === initMsg.activity_id, gwMessageActivityDestroyed, (msg, requestId, initMsg) => msg.activity_id === initMsg.activity_id, (msg) => msg.activity_id, null).then((id) => {
              if (this._config.mode === "trackMyTypeAndInitiatedFromMe") {
                  if (!this._activityTypesInitiatedFromMe[activityType]) {
                      this._activityTypesInitiatedFromMe[activityType] = true;
                      return this._gw3Session
                          .send({
                          type: "subscribe",
                          activity_types: [activityType]
                      })
                          .then(() => {
                          return id;
                      });
                  }
              }
              return id;
          });
      }
      stopActivity(activity) {
          return this._gw3Session.send({
              type: gwMessageDestroyActivity,
              activity_id: activity.id,
              reason_uri: "com.tick42.glue.activity.constants.destroyReason.general",
              reason: "Destroying activity"
          }).then((_) => true);
      }
      updateActivityContext(activity, context, fullReplace, removedKeys) {
          if (fullReplace) {
              return this._contexts.set(activity.id, context);
          }
          else {
              removedKeys = removedKeys || [];
              for (const x of removedKeys) {
                  context[x] = null;
              }
              return this._contexts.update(activity.id, context);
          }
      }
      announceWindow(windowType, activityWindowId) {
          throw new Error("Invalid operation 'announceWindow' for GW3 protocol");
      }
      registerWindow(type, name, independent) {
          let shouldSendReady = typeof this._connection.gatewayToken !== "undefined";
          const peerId = this._connection.peerId;
          if (typeof window !== "undefined") {
              const glue42gd = window.glue42gd;
              if (glue42gd) {
                  shouldSendReady = typeof glue42gd.activityInfo !== "undefined";
              }
          }
          if (shouldSendReady) {
              this._gw3Session.send({
                  type: gwMessageReady,
              });
          }
          this.invokeCallbacks(this._activityWindowChangeCallbacks, new EntityEvent(new ActivityWindow(peerId, name, type, undefined, this.getAgmInstance(peerId), independent, this.generateWindowGetter(peerId), undefined), new EntityEventContext(EntityEventType.Added)), "register window");
          return Promise.resolve(peerId);
      }
      onActivityWindowChange(callback) {
          this._activityWindowChangeCallbacks.push(callback);
      }
      createWindow(activityId, windowDefinition) {
          if (!windowDefinition.layout) {
              if (windowDefinition.left || windowDefinition.width || windowDefinition.height || windowDefinition.top) {
                  windowDefinition.layout = {
                      mode: "pixels",
                      cellSize: 1,
                  };
              }
          }
          const joinPeer = (id) => {
              if (!activityId) {
                  return;
              }
              return this.joinActivity(activityId, id, windowDefinition.name)
                  .then(() => {
                  return id;
              });
          };
          return this.sendCreateAndMapResultingMessagesToPromise({
              type: gwMessageCreatePeer,
              peer_type: windowDefinition.type,
              peer_name: windowDefinition.name || windowDefinition.type,
              configuration: windowDefinition,
              activity_id: activityId,
          }, undefined, undefined, gwMessagePeerCreated, (msg, requestId) => msg.request_id === requestId, undefined, undefined, (msg) => msg.created_id, joinPeer)
              .then(joinPeer);
      }
      async closeWindow(id) {
          await this._gw3Session.send({
              type: gwMessageDestroyPeer,
              destroy_peer_id: id
          });
      }
      getAnnouncementInfo() {
          let activityId = this._config.activityId || (this._config.announcementInfo && this._config.announcementInfo.activityId);
          let activityWindowType = (this._config.announcementInfo && this._config.announcementInfo.activityWindowType);
          let activityWindowIndependent = (this._config.announcementInfo && this._config.announcementInfo.activityWindowIndependent);
          let activityWindowName = (this._config.announcementInfo && this._config.announcementInfo.activityWindowName);
          if (typeof window !== "undefined" &&
              typeof window.location !== "undefined" &&
              window.location.search &&
              typeof URLSearchParams === "function") {
              const searchParams = new URLSearchParams(location.search.slice(1));
              activityWindowType = activityWindowType || searchParams.get("t42PeerType");
              activityWindowType = activityWindowType || searchParams.get("t42ActivityWindowType");
              if (typeof activityWindowIndependent === "undefined") {
                  activityWindowIndependent = searchParams.get("t42ActivityWindowIndependent");
              }
              activityWindowName = activityWindowName || searchParams.get("t42ActivityWindowName");
              activityId = activityId || searchParams.get("t42ActivityId");
          }
          activityWindowType = activityWindowType || "unknown";
          activityWindowIndependent = activityWindowIndependent || false;
          activityWindowName = activityWindowName || this._connection.peerId;
          return {
              activityWindowId: undefined,
              activityId,
              activityWindowType,
              activityWindowIndependent,
              activityWindowName,
          };
      }
      joinActivity(activityId, windowId, name) {
          const maybeName = (name && { name }) || {};
          return this._gw3Session.send({
              type: gwMmessageJoinActivity,
              target_id: windowId,
              activity_id: activityId,
              ...maybeName
          }).then(() => {
              this.invokeCallbacks(this._activityWindowChangeCallbacks, new EntityEvent(new ActivityWindow(windowId, undefined, undefined, activityId, this.getAgmInstance(windowId), undefined, this.generateWindowGetter(windowId), undefined), new EntityEventContext(EntityEventType.ActivityWindowJoinedActivity)), "activity joined - ActivityWindow");
              this.invokeCallbacks(this._activityChangeCallbacks, new EntityEvent(new Activity(activityId, undefined, new ActivityStatus("created", undefined, undefined), undefined, undefined), new EntityEventContext(EntityEventType.Updated)), "activity joined - Activity");
          });
      }
      leaveActivity(activityId, windowId) {
          return this._gw3Session.send({
              type: gwMessageLeaveActivity,
              target_id: windowId,
              activity_id: activityId
          }).then(() => {
              this.invokeCallbacks(this._activityWindowChangeCallbacks, new EntityEvent(new ActivityWindow(windowId, undefined, undefined, null, this.getAgmInstance(windowId), undefined, this.generateWindowGetter(windowId), undefined), new EntityEventContext(EntityEventType.ActivityWindowLeftActivity)), "activity left - ActivityWindow");
              this.invokeCallbacks(this._activityChangeCallbacks, new EntityEvent(new Activity(activityId, undefined, new ActivityStatus("created", undefined, undefined), undefined, undefined), new EntityEventContext(EntityEventType.Updated)), "activity left - Activity");
          });
      }
      getActivityTypes() {
          return Promise.resolve([]);
      }
      getWindowTypes() {
          return Promise.resolve([]);
      }
      getActivities() {
          return Promise.resolve([]);
      }
      getActivityWindows() {
          return Promise.resolve([]);
      }
      createStackedWindows(id, windowDefinitions, timeout) {
          return undefined;
      }
      getWindowBounds(id) {
          return undefined;
      }
      setWindowBounds(id, bounds) {
          return undefined;
      }
      activateWindow(id, focus) {
          return undefined;
      }
      setWindowVisibility(id, visible) {
          return undefined;
      }
      cloneActivity(id, cloneOptions) {
          return undefined;
      }
      attachActivities(from, to, tag) {
          return this._gw3Session.send({
              type: gwNmessageMergeActivities,
              into: to,
              merge: from
          });
      }
      detachActivities(activityId, newActivityInfo) {
          return this._gw3Session.send({
              type: gwMessageSplitActivities,
              from: activityId,
          }).then(() => "");
      }
      onActivitiesAttached(callback) {
      }
      onActivitiesDetached(callback) {
      }
      onActivityAttachedDescriptorsRefreshed(callback) {
      }
      getAttachedDescriptors() {
          return Promise.resolve([]);
      }
      getRandomRequestId() {
          return this._connection.peerId + ":" + Math.floor(Math.random() * 1e9) + "";
      }
      forwardAddedAndRemovedMessagesToEventHandler(addedMessageType, removedMessageType, mapper, handlers) {
          const getGetEntityEvent = (isAdded) => (entity) => new EntityEvent(entity, new EntityEventContext(isAdded ?
              EntityEventType.Added :
              EntityEventType.Removed));
          const sub1 = addedMessageType && this.forwardMessageToEventHandler(addedMessageType, (msg) => mapper(msg, true), getGetEntityEvent(true), handlers);
          const sub2 = removedMessageType && this.forwardMessageToEventHandler(removedMessageType, (msg) => mapper(msg, false), getGetEntityEvent(false), handlers);
          return [sub1, sub2].filter((x) => x);
      }
      forwardMessageToEventHandler(messageType, mapper, getEntityEvent, handler) {
          return this.subscribe(messageType, (msg) => {
              mapper(msg)
                  .forEach((ent) => handler.forEach((h) => h(getEntityEvent(ent, msg))));
          });
      }
      sendCreateAndMapResultingMessagesToPromise(msg, initiatedMessageType, initiatedMessageFilter, createdMessageType, createdMessageFilter, cancelledMessageType, cancelledMessageFilter, createdMessageToPromiseResolution, listenForRecreates) {
          const reqId = this.getRandomRequestId();
          let resolveCreatedPromise;
          let rejectCreatedPromise;
          const createdPromise = new Promise((resolve, reject) => {
              resolveCreatedPromise = resolve;
              rejectCreatedPromise = reject;
          });
          let initiatedMessageAck = null;
          let initiatedSubscription;
          let createdSubscription;
          let cancelledSubscription;
          let errorSubscription;
          const dropSubscriptions = () => {
              this.dropSubscription(initiatedSubscription);
              if (!listenForRecreates) {
                  this.dropSubscription(createdSubscription);
              }
              this.dropSubscription(cancelledSubscription);
              this.dropSubscription(errorSubscription);
          };
          initiatedSubscription = initiatedMessageType &&
              this.subscribe(initiatedMessageType, (msg4) => {
                  if (!initiatedMessageFilter(msg4, reqId)) {
                      return;
                  }
                  initiatedMessageAck = msg4;
                  this.dropSubscription(initiatedSubscription);
              });
          let recreated = false;
          createdSubscription =
              this.subscribe(createdMessageType, (msg1) => {
                  if (!createdMessageFilter(msg1, reqId, initiatedMessageAck)) {
                      return;
                  }
                  if (recreated) {
                      if (listenForRecreates) {
                          listenForRecreates(createdMessageToPromiseResolution(msg1));
                      }
                  }
                  else {
                      recreated = true;
                      resolveCreatedPromise(createdMessageToPromiseResolution(msg1));
                  }
              });
          cancelledSubscription = cancelledMessageType &&
              this.subscribe(cancelledMessageType, (msg2) => {
                  if (!cancelledMessageFilter(msg2, reqId, initiatedMessageAck)) {
                      return;
                  }
                  rejectCreatedPromise(msg2);
              });
          errorSubscription = cancelledMessageType &&
              this.subscribe(gwMmessageError, (msg3) => {
                  if (msg3.request_id !== reqId) {
                      return;
                  }
                  rejectCreatedPromise(msg3);
              });
          msg.request_id = reqId;
          const toReturn = this._gw3Session
              .send(msg)
              .then(() => {
              return createdPromise;
          });
          toReturn.then(dropSubscriptions, dropSubscriptions);
          return toReturn;
      }
      peerFactoryIdAndOwnerIdToWindowType(factoryId, ownerId) {
          const peerType = this._peerIdAndFactoryIdToPeerType[ownerId + ":" + factoryId];
          if (!peerType) {
              return null;
          }
          else {
              return new WindowType(peerType, undefined);
          }
      }
      subscribe(messageType, handler) {
          const sub = this._connection.on(messageType, (msg) => handler.bind(this)(msg));
          this._gw3Subscriptions.push(sub);
          return sub;
      }
      dropSubscription(subscription) {
          if (subscription) {
              this._connection.off(subscription);
              delete this._gw3Subscriptions[this._gw3Subscriptions.indexOf(subscription)];
          }
      }
      invokeCallbacks(callbacks, event, description) {
          callbacks.forEach((cb) => {
              try {
                  cb(event);
              }
              catch (err) {
                  this._logger.error(`Error in ${description || event.context.type} callback: ` + JSON.stringify(err));
              }
          });
      }
      handleActivityCreatedMessage(msg) {
          if (!msg.context_id) {
              this._logger.error("Activity created with unknown context_id: " + msg.activity_id);
          }
          else {
              if (!this._contextSubscriptions[msg.activity_id]) {
                  this.subscribeToContext(msg);
              }
          }
      }
      async subscribeToContext(msg) {
          const activityId = msg.activity_id;
          this._contextSubscriptions[activityId] =
              await this._contexts.subscribe(activityId, (data, updated, removed) => {
                  const event = new EntityEvent(new Activity(activityId, undefined, undefined, data, undefined), new ActivityContextChangedEventContext(data, updated, removed));
                  this.invokeCallbacks(this._activityChangeCallbacks, event, "context updated");
              });
      }
      handleActivityDestroyedMessage(msg) {
          const unsubscribeContext = this._contextSubscriptions[msg.activity_id];
          if (typeof unsubscribeContext === "function") {
              unsubscribeContext();
          }
          delete this._contextSubscriptions[msg.activity_id];
      }
      handlePeerFactoriesAdded(msg) {
          msg.factories.forEach((entity) => {
              this._peerIdAndFactoryIdToPeerType[msg.owner_id + ":" + entity.id] = entity.peer_type;
          });
      }
      handlePeerFactoriesRemoved(msg) {
          msg.factory_ids.forEach((factoryId) => {
              delete this._peerIdAndFactoryIdToPeerType[msg.owner_id + ":" + factoryId];
          });
      }
      forwardActivityTypeMessagesToStatusEventHandlers() {
          this.forwardAddedAndRemovedMessagesToEventHandler(gwMmessageActivityTypesAdded, gwMessageActivityTypesRemoved, (msg, isAdded) => isAdded
              ? msg.types.map((t) => GW3Bridge.activityTypeGwMessageEntityToActivityType(t, undefined))
              : msg.types.map((t) => new ActivityType(t.name, undefined, undefined, undefined)), this._activityTypeStatusChangeCallbacks);
      }
      forwardActivityCreatedAndJoinedActivityToActivityWindowEventHandlers() {
          for (const activityCreatedMessage of [gwMessageActivityCreated, gwMessageJoinedActivity, gwMessageOwnerChanged]) {
              this.forwardMessageToEventHandler(activityCreatedMessage, (msg) => ([msg.owner || { ...msg, type: msg.peer_type, name: msg.peer_name, peer_id: msg.owner_id }])
                  .concat(msg.participants || [])
                  .map((info) => new ActivityWindow(info.peer_id, info.name, info.type, msg.activity_id, this.getAgmInstance(info.peer_id), undefined, this.generateWindowGetter(info.peer_id), undefined)), (ent, msg) => new EntityEvent(ent, new EntityEventContext(EntityEventType.ActivityWindowJoinedActivity)), this._activityWindowChangeCallbacks);
          }
      }
      forwardActivityMessagesToStatusEventHandlers() {
          for (const createdMessage of [gwMessageActivityCreated, gwMessageJoinedActivity]) {
              this.forwardMessageToEventHandler(createdMessage, (msg) => [GW3Bridge.activityGwMessageToActivity(msg, new ActivityStatus("started", "", new Date()))], (ent, msg) => GW3Bridge.activityToActivityStatusChangeEvent(ent), this._activityChangeCallbacks);
          }
          this.forwardMessageToEventHandler(gwMessageActivityDestroyed, (msg) => [GW3Bridge.activityGwMessageToActivity(msg, new ActivityStatus("destroyed", msg.reason, new Date()))], (ent, msg) => GW3Bridge.activityToActivityStatusChangeEvent(ent), this._activityChangeCallbacks);
          this.forwardMessageToEventHandler(gwMessageActivityInitiated, (msg) => [GW3Bridge.activityGwMessageToActivity(msg, new ActivityStatus("created", "", new Date()))], (ent, msg) => GW3Bridge.activityToActivityStatusChangeEvent(ent), this._activityChangeCallbacks);
          this.forwardMessageToEventHandler(gwMessageOwnerChanged, (msg) => [GW3Bridge.activityGwMessageToActivity(msg, new ActivityStatus("created", "", new Date()))], (ent, msg) => GW3Bridge.activityToActivityStatusChangeEvent(ent), this._activityChangeCallbacks);
      }
      forwardPeerFactoryMessagesToStatusEventHandlers() {
          this.forwardAddedAndRemovedMessagesToEventHandler(gwMessagePeerFactoriesAdded, gwMessagePeerFactoriesRemoved, (msg, isAdded) => isAdded
              ? msg.factories.map(GW3Bridge.peerFactoryGwMessageEntityToWindowType)
              : msg.factory_ids.map((id) => this.peerFactoryIdAndOwnerIdToWindowType(id, msg.owner_id)).filter((x) => x != null), this._windowTypeStatusChangeCallbacks);
      }
      forwardPeerFactoryMessagesToPeerFactoryRequests() {
          this.subscribe(gwMessagePeerRequested, (msg) => {
              const factory = this._peerFactoriesRegisteredByUs[msg.peer_factory];
              if (!factory) {
                  this._gw3Session.send({
                      type: gwMmessageError,
                      request_id: msg.request_id,
                      reason: `Unknown peer factory ${msg.peer_factory}`
                  });
                  return;
              }
              try {
                  const configuration = msg.configuration || {};
                  configuration.gateway_token = configuration.gateway_token || msg.gateway_token;
                  configuration.peer_factory = configuration.peer_factory || msg.peer_factory;
                  const promise = factory({
                      activityId: msg.activity && msg.activity.id,
                      activityType: msg.activity && msg.activity.type,
                      type: msg.configuration && msg.configuration.type,
                      gwToken: configuration.gateway_token,
                      configuration
                  });
                  if (promise && promise.then && promise.catch) {
                      promise.catch((err) => this._gw3Session.send({
                          type: gwMmessageError,
                          request_id: msg.request_id,
                          reason: err && (err.message || JSON.stringify(err))
                      }));
                  }
              }
              catch (err) {
                  this._gw3Session.send({
                      type: gwMmessageError,
                      request_id: msg.request_id,
                      reason: err && (err.message || JSON.stringify(err))
                  });
              }
          });
      }
      forwardActivityWindowMessagesToEventHandlers() {
          for (const joinedMessage of [gwMessageActivityJoined, gwMessageJoinedActivity]) {
              this.subscribe(joinedMessage, (msg) => {
                  const joinedId = (joinedMessage === gwMessageActivityJoined) ? msg.joined_id : msg.peer_id;
                  const joinedType = (joinedMessage === gwMessageActivityJoined) ? msg.joined_type : msg.peer_type;
                  const joinedName = (joinedMessage === gwMessageActivityJoined) ? msg.joined_name : msg.peer_name;
                  const entity = new ActivityWindow(joinedId, joinedName, joinedType, msg.activity_id, this.getAgmInstance(joinedId), undefined, this.generateWindowGetter(joinedId), undefined);
                  if (!this._contextSubscriptions[msg.activity_id]) {
                      this.subscribeToContext(msg).then(() => {
                          if (joinedMessage === gwMessageJoinedActivity) {
                              this._activityJoinedPromiseResolve({});
                          }
                      });
                  }
                  else if (joinedMessage === gwMessageJoinedActivity) {
                      this._activityJoinedPromiseResolve({});
                  }
                  this.invokeCallbacks(this._activityWindowChangeCallbacks, new EntityEvent(entity, new EntityEventContext(EntityEventType.ActivityWindowJoinedActivity)), joinedMessage);
              });
          }
          this.subscribe(gwMessageActivityLeft, (msg) => {
              const entity = new ActivityWindow(msg.left_id, undefined, undefined, null, this.getAgmInstance(msg.left_id), undefined, this.generateWindowGetter(msg.left_id), undefined);
              this.invokeCallbacks(this._activityWindowChangeCallbacks, new EntityEvent(entity, new EntityEventContext(EntityEventType.ActivityWindowLeftActivity)), gwMessageActivityLeft);
          });
          this.forwardAddedAndRemovedMessagesToEventHandler(gwMessagePeerCreated, undefined, (msg) => [
              new ActivityWindow(msg.created_id, undefined, undefined, undefined, undefined, undefined, this.generateWindowGetter(msg.created_id), undefined)
          ], this._activityWindowChangeCallbacks);
      }
      getAgmInstance(id) {
          return this._config.agm.servers().find((s) => s.peerId === id || s.windowId === id);
      }
      generateWindowGetter(peerId) {
          return () => {
              const server = this.getAgmInstance(peerId);
              if (!server) {
                  return;
              }
              const windowId = server.windowId;
              return this._config.windows.list().filter((w) => w.id === windowId)[0];
          };
      }
      isOverrideTypeDefinition(value) {
          if (typeof value === "undefined") {
              return false;
          }
          if (value.owner) {
              return true;
          }
          return false;
      }
  }

  class ActivityMy {
      constructor(manager, windows) {
          this._myAttached = [];
          this._myDetached = [];
          this._myAttachedTo = [];
          this._myDetachedFrom = [];
          this._myActivityFrameColorChanged = [];
          this._myActivityJoinedCallbacks = [];
          this._myActivityRemovedCallbacks = [];
          this._myContextUpdateCallbacks = [];
          this._logger = Logger.Get(this);
          this._m = manager;
          manager.ready()
              .then((am) => {
              am.subscribeActivityContextChanged(this._subscribeMyContextChanged.bind(this));
              am.subscribeWindowEvents(this._subscribeMyWindowEvent.bind(this));
              am.subscribeActivitiesAttached(this._subscribeActivitiesAttached.bind(this));
              am.subscribeActivitiesDetached(this._subscribeActivitiesDetached.bind(this));
              if (windows) {
                  windows.onWindowFrameColorChanged(this._subscribeWindowFrameColorChanged.bind(this));
              }
          });
      }
      get window() {
          if (isUndefinedOrNull(this._w)) {
              const announcedWindows = this._m.announcedWindows;
              if (announcedWindows.length > 0) {
                  this._w = announcedWindows[0];
              }
          }
          return this._w;
      }
      get activity() {
          const myWin = this.window;
          if (isUndefinedOrNull(myWin)) {
              return undefined;
          }
          return myWin.activity;
      }
      createWindow(windowType) {
          return this._m.createWindow(this.activity, windowType);
      }
      createStackedWindows(windowTypes, timeout) {
          return this._m.createStackedWindows(this.activity, windowTypes, timeout);
      }
      get context() {
          const activity = this.activity;
          if (isUndefined(activity)) {
              return {};
          }
          return activity.context;
      }
      updateContext(context, callback) {
          const activity = this.activity;
          if (isUndefined(activity)) {
              return new Promise((resolve, reject) => {
                  reject("Not in activity");
              });
          }
          return activity.updateContext(context, callback);
      }
      setContext(context, callback) {
          const activity = this.activity;
          if (isUndefined(activity)) {
              return new Promise((resolve, reject) => {
                  reject("Not in activity");
              });
          }
          return activity.setContext(context, callback);
      }
      onActivityJoined(callback) {
          this._myActivityJoinedCallbacks.push(callback);
          const myWin = this.window;
          if (!isUndefinedOrNull(myWin) && !isUndefinedOrNull(myWin.activity)) {
              callback(myWin.activity);
          }
      }
      onActivityLeft(callback) {
          this._myActivityRemovedCallbacks.push(callback);
      }
      onContextChanged(callback) {
          this._myContextUpdateCallbacks.push(callback);
          const myWin = this.window;
          if (isUndefinedOrNull(myWin)) {
              return;
          }
          const activity = myWin.activity;
          if (isUndefinedOrNull(activity)) {
              return;
          }
          callback(activity.context, activity.context, [], activity);
      }
      clone(options, callback) {
          const act = this.activity;
          return this._m.clone(act, options, callback);
      }
      attach(activity, tag) {
          let activityId;
          if (typeof activity === "string") {
              activityId = activity;
          }
          else {
              activityId = activity.id;
          }
          return this._m.attachActivities(activityId, this.activity.id, tag);
      }
      onActivityAttached(callback) {
          this._myAttached.push(callback);
      }
      onActivityDetached(callback) {
          this._myDetached.push(callback);
      }
      onAttachedToActivity(callback) {
          this._myAttachedTo.push(callback);
      }
      onDetachedFromActivity(callback) {
          this._myDetachedFrom.push(callback);
      }
      get attached() {
          if (!this.activity) {
              return [];
          }
          return this.activity.attached;
      }
      setFrameColor(color, callback) {
          if (this.activity) {
              return this.activity.setFrameColor(color, callback);
          }
          else {
              return Promise.resolve(null);
          }
      }
      getFrameColor() {
          if (this.activity) {
              return this.activity.getFrameColor();
          }
          return "";
      }
      onFrameColorChanged(callback) {
          this._myActivityFrameColorChanged.push(callback);
      }
      _subscribeMyContextChanged(activity, context, delta, removed) {
          const myWin = this.window;
          if (isUndefinedOrNull(myWin)) {
              return;
          }
          const myActivity = myWin.activity;
          if (isUndefinedOrNull(myActivity)) {
              return;
          }
          if (activity.id !== myActivity.id) {
              return;
          }
          this._notifyMyContextChanged(activity, context, delta, removed);
      }
      _subscribeMyWindowEvent(activity, window, event) {
          if (isUndefinedOrNull(this.window)) {
              return;
          }
          if (this.window.id !== window.id) {
              return;
          }
          if (event === EntityEventType.ActivityWindowJoinedActivity) {
              this._notifyMyWindowEvent(activity, this._myActivityJoinedCallbacks);
              this._notifyMyContextChanged(activity, activity.context, null, null);
          }
          else if (event === EntityEventType.ActivityWindowLeftActivity) {
              this._notifyMyWindowEvent(activity, this._myActivityRemovedCallbacks);
          }
      }
      _notifyMyWindowEvent(activity, callbackStore) {
          callbackStore.forEach((element) => {
              try {
                  element(activity, event);
              }
              catch (e) {
                  this._logger.warn("error in user callback " + e);
              }
          });
      }
      _notifyMyContextChanged(activity, context, delta, removed) {
          delta = delta || {};
          removed = removed || [];
          this._myContextUpdateCallbacks.forEach((element) => {
              try {
                  element(context, delta, removed, activity);
              }
              catch (e) {
                  this._logger.warn("error in user callback " + e);
              }
          });
      }
      _notifyAttached(state) {
          this._myAttached.forEach((cb) => {
              try {
                  cb(state);
              }
              catch (e) {
                  this._logger.warn("error in user callback " + e);
              }
          });
      }
      _notifyDetached(state) {
          this._myDetached.forEach((cb) => {
              try {
                  cb(state);
              }
              catch (e) {
                  this._logger.warn("error in user callback " + e);
              }
          });
      }
      _notifyAttachedTo(state) {
          this._myAttachedTo.forEach((cb) => {
              try {
                  cb(this.activity, state);
              }
              catch (e) {
                  this._logger.warn("error in user callback " + e);
              }
          });
      }
      _notifyDetachedFrom(detached, existing, state) {
          this._myDetachedFrom.forEach((cb) => {
              try {
                  cb(detached, existing, state);
              }
              catch (e) {
                  this._logger.warn("error in user callback " + e);
              }
          });
      }
      _subscribeActivitiesAttached(newAct, state) {
          const myWin = this.window;
          if (isUndefinedOrNull(myWin)) {
              return;
          }
          const myActivity = myWin.activity;
          if (isUndefinedOrNull(myActivity)) {
              return;
          }
          if (newAct.id !== myActivity.id) {
              return;
          }
          if (state.windowIds.indexOf(myWin.id) >= 0) {
              this._notifyAttachedTo(state);
              return;
          }
          this._notifyAttached(state);
      }
      _subscribeActivitiesDetached(newAct, oldAct, state) {
          const myWin = this.window;
          if (isUndefinedOrNull(myWin)) {
              return;
          }
          const myActivity = myWin.activity;
          if (isUndefinedOrNull(myActivity)) {
              return;
          }
          if (oldAct.id === myActivity.id) {
              this._notifyDetached(state);
          }
          if (newAct.id === myActivity.id) {
              this._notifyDetachedFrom(newAct, oldAct, state);
          }
      }
      _subscribeWindowFrameColorChanged(window) {
          const act = this.activity;
          if (!act) {
              return;
          }
          if (!act.owner) {
              return;
          }
          if (act.owner.underlyingWindow.id === window.id) {
              this._myActivityFrameColorChanged.forEach((callback) => {
                  callback(window.frameColor);
              });
          }
      }
  }

  class ReadyMarker {
      constructor(name, signalsToWait) {
          this._logger = Logger.Get("ReadyMarker [" + name + "]");
          this._logger.debug("Initializing ready marker for '" + name + "' with " + signalsToWait + " signals to wait");
          if (signalsToWait <= 0) {
              throw new Error("Invalid signal number. Should be > 0");
          }
          this._signals = signalsToWait;
          this._callbacks = [];
          this._name = name;
      }
      setCallback(callback) {
          if (this.isSet()) {
              callback(undefined);
              return;
          }
          else if (this.isError()) {
              callback(this._error);
              return;
          }
          this._callbacks.push(callback);
      }
      signal(message) {
          this._logger.debug("Signaled - " + message + " - signals left " + (this._signals - 1));
          this._signals--;
          if (this._signals < 0) {
              throw new Error("Error in ready marker '" + this._name + " - signals are " + this._signals);
          }
          if (this.isSet()) {
              this._callbacks.forEach((callback) => {
                  callback(undefined);
              });
          }
      }
      error(error) {
          this._error = error;
          this._callbacks.forEach((errorCallback) => {
              errorCallback(error);
          });
      }
      isSet() {
          if (this.isError()) {
              return false;
          }
          return this._signals === 0;
      }
      isError() {
          return !isUndefined(this._error);
      }
      getError() {
          return this._error;
      }
  }

  class EntityObservableCollection {
      constructor(processNew) {
          this._items = {};
          this._listeners = [];
          this._processNew = processNew;
      }
      addOne(item) {
          this.add([item]);
      }
      add(items) {
          items.forEach((element) => {
              this.process(new EntityEvent(element, new EntityEventContext(EntityEventType.Added)));
          });
      }
      process(event) {
          const context = event.context;
          const type = context.type;
          const entity = event.entity;
          if (type === EntityEventType.StatusChange &&
              !context.oldStatus) {
              const act = this._items[entity.id];
              if (act) {
                  context.oldStatus = act.status;
              }
          }
          if (type === EntityEventType.StatusChange &&
              context.oldStatus &&
              context.newStatus &&
              context.oldStatus.state ===
                  context.newStatus.state) {
              context.type = EntityEventType.Updated;
          }
          if (typeof htmlContainer === "undefined") {
              if (type === EntityEventType.ActivityWindowJoinedActivity &&
                  this._items[entity.id] &&
                  this._items[entity.id].activity) {
                  context.type = EntityEventType.Updated;
              }
              if (type === EntityEventType.ActivityWindowLeftActivity &&
                  this._items[entity.id] &&
                  !this._items[entity.id].activity) {
                  context.type = EntityEventType.Updated;
              }
          }
          const internalEntity = this._updateInternalCollections(entity, type, context);
          this._notifyListeners(internalEntity, context);
          return internalEntity;
      }
      get() {
          const result = [];
          for (const key in this._items) {
              if (this._items.hasOwnProperty(key)) {
                  const element = this._items[key];
                  result.push(element);
              }
          }
          return result;
      }
      getByName(name) {
          for (const key in this._items) {
              if (key === name) {
                  return this._items[key];
              }
          }
          return undefined;
      }
      getOrWait(name) {
          return new Promise((resolve) => {
              const entityAddedHandler = (entity) => {
                  if (entity.id !== name) {
                      return;
                  }
                  resolve(entity);
                  this.unsubscribe(entityAddedHandler);
              };
              this.subscribe(entityAddedHandler);
              const window = this.getByName(name);
              if (window) {
                  this.unsubscribe(entityAddedHandler);
                  resolve(window);
                  return;
              }
          });
      }
      subscribe(handler) {
          this._listeners.push(handler);
          Object.keys(this._items).forEach((key) => {
              const element = this._items[key];
              handler(element, new EntityEventContext(EntityEventType.Added.toString()));
          });
          return () => {
              this.unsubscribe(handler);
          };
      }
      unsubscribe(handler) {
          const index = this._listeners.indexOf(handler);
          if (index !== -1) {
              this._listeners.splice(index, 1);
          }
      }
      _notifyListeners(entity, context) {
          this._listeners.forEach((listener) => {
              try {
                  listener(entity, context);
              }
              catch (e) {
                  return;
              }
          });
      }
      _updateInternalCollections(entity, type, context) {
          const entityAsAny = entity;
          const isActivityDestroy = (type === EntityEventType.StatusChange &&
              entityAsAny.status &&
              entityAsAny.status.state === ActivityState.Destroyed) ||
              (type === EntityEventType.StatusChange &&
                  context &&
                  context.newStatus &&
                  context.newStatus.state === ActivityState.Destroyed);
          const isWindowClose = type === EntityEventType.Closed;
          const isTypeRemove = type === EntityEventType.Removed && typeof entityAsAny.isIndependent === "undefined";
          if (isTypeRemove || isWindowClose || isActivityDestroy) {
              const oldEntity = this._items[entity.id];
              delete this._items[entity.id];
              this._processNew(entity);
              if (oldEntity) {
                  entity._beforeDelete(oldEntity);
              }
              return entity;
          }
          else {
              const key = entity.id;
              if (!this._items.hasOwnProperty(key)) {
                  this._processNew(entity);
                  this._items[entity.id] = entity;
              }
              else {
                  this._items[entity.id]._update(entity);
              }
          }
          return this._items[entity.id];
      }
  }

  class ActivityManager {
      get usingHc() {
          return this._bridge.bridgeType === "HC";
      }
      get announcedWindows() {
          return this._announcedWindows;
      }
      set announcedWindows(v) {
          throw new Error("not allowed");
      }
      constructor(bridge, autoAnnounce, windows) {
          this._logger = Logger.Get("activityManager");
          this._announcedWindows = [];
          this._attachedCallbacks = [];
          this._detachedCallbacks = [];
          this._frameColorChangesCallbacks = [];
          this._windowHandlers = [];
          this._bridge = bridge;
          this._activityTypes = new EntityObservableCollection((e) => this._grabEntity(e));
          this._windowTypes = new EntityObservableCollection((e) => this._grabEntity(e));
          this._activities = new EntityObservableCollection((e) => this._grabEntity(e));
          this._windows = new EntityObservableCollection((e) => this._grabEntity(e));
          this._dataReadyMarker = new ReadyMarker("Activity Manager Data", ["GetActivityTypes", "GetWindowTypes", "GetActivities", "GetWindows"].length);
          this._descriptorsMarker = new ReadyMarker("Attached Activities Descriptors", ["GetDescriptors"].length);
          if (autoAnnounce) {
              this._readyMarker = new ReadyMarker("Activity Manager Announce", ["Announcement"].length);
              this._dataReadyMarker.setCallback((dataErr) => {
                  if (dataErr) {
                      this._readyMarker.error(dataErr);
                  }
                  this._descriptorsMarker.setCallback((err) => {
                      if (err) {
                          this._readyMarker.error(err);
                      }
                      this._logger.debug("Auto announcing window");
                      this.announceWindow()
                          .then((w) => {
                          this._announcedWindows.push(w);
                          this._readyMarker.signal("Successfully announced window with id '" + w.id + "'");
                      })
                          .catch((errCatch) => {
                          this._logger.debug("Will not announce window - " + errCatch);
                          this._readyMarker.signal();
                      });
                  });
                  this.refreshDescriptors();
              });
          }
          else {
              this._readyMarker = this._dataReadyMarker;
          }
          this._bridge.onActivitiesAttached((e) => {
              this._handleActivitiesAttached(e);
          });
          this._bridge.onActivitiesDetached((e) => {
              this._handleActivitiesDetached(e);
          });
          this._bridge.onActivityAttachedDescriptorsRefreshed((e) => {
              this._handleActivityDescriptorsRefreshed(e);
          });
          if (windows) {
              windows.onWindowFrameColorChanged(this._handleWindowFrameColorChanged.bind(this));
          }
          this._bridge.init();
          this._subscribeForData();
          this._bridge
              .initReady()
              .then((aw) => {
              this._getInitialData();
          })
              .catch((error) => {
              console.log(error);
          });
      }
      ready(callback) {
          const promise = new Promise((resolve, reject) => {
              this._readyMarker.setCallback((err) => {
                  if (!err) {
                      resolve(this);
                  }
                  else {
                      reject(this._readyMarker.getError());
                  }
              });
          });
          return nodeify(Promise.all([this._bridge.ready(), promise]).then(() => this), callback);
      }
      getActivityTypes() {
          return this._activityTypes.get();
      }
      getActivityType(name) {
          return this._activityTypes.getByName(name);
      }
      registerActivityType(activityTypeName, ownerWindowType, helperWindowTypes, config, description, callback) {
          const promise = new Promise((resolve, reject) => {
              if (isUndefinedOrNull(activityTypeName)) {
                  reject("activityTypeName argument can not be undefined");
                  return;
              }
              if (!isString(activityTypeName)) {
                  reject("activityTypeName should be string");
                  return;
              }
              const actType = this.getActivityType(activityTypeName);
              if (!isUndefinedOrNull(actType)) {
                  reject("Activity type '" + activityTypeName + "' already exists");
                  return;
              }
              let ownerDefinition;
              if (isUndefined(ownerWindowType)) {
                  reject("Owner window type can not be undefined");
                  return;
              }
              if (isString(ownerWindowType)) {
                  ownerDefinition = { type: (ownerWindowType), name: "", isIndependent: false, arguments: {} };
              }
              else {
                  ownerDefinition = (ownerWindowType);
              }
              const helperDefinitions = [];
              if (!isUndefined(helperWindowTypes) && isArray(helperWindowTypes)) {
                  for (const index in helperWindowTypes) {
                      const item = helperWindowTypes[index];
                      if (isString(item)) {
                          const definition = {
                              type: (item),
                              name: "",
                              isIndependent: false,
                              arguments: {},
                              relativeTo: "",
                              relativeDirection: "",
                              windowStyleAttributes: {}
                          };
                          helperDefinitions.push(definition);
                      }
                      else {
                          helperDefinitions.push(item);
                      }
                  }
              }
              this._bridge
                  .registerActivityType(activityTypeName, ownerDefinition, helperDefinitions, config, description)
                  .then((activityType) => {
                  this._grabEntity(activityType);
                  resolve(activityType);
              })
                  .catch((error) => {
                  reject(error);
              });
          });
          return nodeify(promise, callback);
      }
      unregisterActivityType(type, callback) {
          const promise = new Promise((resolve, reject) => {
              const actType = this.getActivityType(type);
              if (isUndefined(actType)) {
                  reject("Activity type '" + type + "' does not exists");
                  return;
              }
              this._bridge.unregisterActivityType(type).then(() => resolve(actType), reject);
          });
          return nodeify(promise, callback);
      }
      initiate(activityType, context, callback, configuration) {
          const promise = new Promise((resolve, reject) => {
              const actType = this.getActivityType(activityType);
              if (isUndefined(actType)) {
                  reject("Activity type '" + activityType + "' does not exists");
                  return;
              }
              this._bridge
                  .initiateActivity(activityType, context, configuration)
                  .then((actId) => {
                  this._activities
                      .getOrWait(actId)
                      .then((act) => {
                      resolve(act);
                  })
                      .catch((err) => reject(err));
              })
                  .catch((err) => {
                  reject(err);
              });
          });
          return nodeify(promise, callback);
      }
      subscribeActivityTypeEvents(handler) {
          this._activityTypes.subscribe((at, context) => {
              handler(at, context.type);
          });
      }
      getWindowTypes() {
          return this._windowTypes.get();
      }
      getWindowType(name) {
          return this._windowTypes.getByName(name);
      }
      registerWindowFactory(windowType, factoryMethod, callback) {
          const promise = new Promise((resolve, reject) => {
              if (isUndefinedOrNull(windowType)) {
                  reject("no windowType specified");
                  return;
              }
              if (isObject(windowType)) {
                  windowType = windowType.getName();
              }
              else if (!isString(windowType)) {
                  reject("windowType should be string or object that has getName method");
                  return;
              }
              this._bridge
                  .registerWindowFactory(windowType, factoryMethod)
                  .then((v) => {
                  resolve(v);
              })
                  .catch((err) => {
                  reject(err);
              });
          });
          return nodeify(promise, callback);
      }
      unregisterWindowFactory(windowType, callback) {
          const promise = new Promise((resolve, reject) => {
              if (isUndefinedOrNull(windowType)) {
                  reject("no windowType specified");
                  return;
              }
              if (!isString(windowType)) {
                  reject("windowType should be a string");
                  return;
              }
              this._bridge
                  .unregisterWindowFactory(windowType)
                  .then((v) => {
                  resolve(v);
              })
                  .catch((err) => {
                  reject(err);
              });
          });
          return nodeify(promise, callback);
      }
      getActivities(activityType) {
          let act = this._activities.get();
          act = act.filter((a) => a._ownerId);
          if (!activityType) {
              return act;
          }
          let types = activityType;
          if (isString(activityType)) {
              types = [activityType];
          }
          else if (activityType instanceof ActivityType) {
              types = [activityType.name];
          }
          else if (activityType instanceof Array) ;
          else {
              throw new Error("Invalid input argument 'activityType' = " + activityType);
          }
          return act.filter((at) => {
              const type = at.type;
              return some(types, (t) => {
                  return type.id === t.id;
              });
          });
      }
      getActivityById(id) {
          return this._activities.getByName(id);
      }
      announceWindow(activityWindowId, windowType) {
          const promise = new Promise((resolve, reject) => {
              const announcementInfo = this._bridge.getAnnouncementInfo();
              if (isUndefined(activityWindowId)) {
                  activityWindowId = announcementInfo.activityWindowId;
              }
              if (isUndefined(windowType)) {
                  windowType = announcementInfo.activityWindowType;
              }
              if (isUndefinedOrNull(windowType)) {
                  throw new Error("Can not announce - unknown windowType");
              }
              const activityId = announcementInfo && announcementInfo.activityId;
              if (isUndefinedOrNull(activityWindowId)) {
                  this._logger.debug("Registering window with type:'" + windowType + "', name:'" + announcementInfo.activityWindowName + "', ind.:'" + announcementInfo.activityWindowIndependent + "'");
                  this._bridge.registerWindow(windowType, announcementInfo.activityWindowName, announcementInfo.activityWindowIndependent)
                      .then(this._windows.getOrWait.bind(this._windows))
                      .then((w) => {
                      if (activityId) {
                          return this._activities.getOrWait(activityId).then((_) => w);
                      }
                      else {
                          return w;
                      }
                  })
                      .then((w) => {
                      resolve(w);
                  })
                      .catch((err) => {
                      this._logger.error(err);
                  });
              }
              else {
                  this._logger.debug("Announcing window with id '" + activityWindowId + "' and type '" + windowType + "'");
                  const currentWindow = this._windows.getByName(activityWindowId);
                  if (!isUndefinedOrNull(currentWindow)) {
                      this._logger.debug("Window with id '" + activityWindowId + "' already announced - reusing the window");
                      resolve(currentWindow);
                      return;
                  }
                  const windowEventHandler = (a, w, e) => {
                      if (activityWindowId === w.id) {
                          if (e === EntityEventType.ActivityWindowJoinedActivity) {
                              const activity = w.activity;
                              if (isUndefined(activity)) {
                                  reject("UNDEFINED ACTIVITY");
                              }
                              this._logger.trace("Got joined event for id '" + activityWindowId + "'");
                              resolve(w);
                              this.unsubscribeWindowEvents(windowEventHandler);
                          }
                      }
                  };
                  this.subscribeWindowEvents(windowEventHandler);
                  this._logger.trace("Waiting for joined event for id '" + activityWindowId + "'");
                  this._bridge.announceWindow(windowType, activityWindowId);
              }
          });
          return promise;
      }
      subscribeWindowTypeEvents(handler) {
          this._windowTypes.subscribe((wt, context) => {
              handler(wt, context.type);
          });
      }
      subscribeActivityEvents(handler) {
          return this._activities.subscribe((act, context) => {
              if (context.type === EntityEventType.StatusChange) {
                  const p = context;
                  handler(act, p.newStatus, p.oldStatus);
              }
              if (context.type === EntityEventType.Removed ||
                  (context.type === EntityEventType.StatusChange &&
                      context.newStatus.getState() === ActivityState.Destroyed)) {
                  for (const window of this._windows.get()) {
                      if (window.activity && window.activity.id === act.id) {
                          this._windows.process(new EntityEvent(window, new EntityEventContext(EntityEventType.ActivityWindowLeftActivity)));
                      }
                  }
              }
          });
      }
      subscribeWindowEvents(handler) {
          const wrappingHandler = (window, context) => {
              let eventType = context.type;
              if (eventType === EntityEventType.Added) {
                  eventType = "opened";
              }
              handler(window.activity, window, eventType);
          };
          this._windowHandlers.push([handler, wrappingHandler]);
          return this._windows.subscribe(wrappingHandler);
      }
      unsubscribeWindowEvents(handler) {
          const found = this._windowHandlers.find((pair) => pair[0] === handler);
          if (found) {
              this._windowHandlers.splice(this._windowHandlers.indexOf(found), 1);
              this._windows.unsubscribe(found[1]);
          }
      }
      createWindow(activity, windowTypeOrConfiguration, callback) {
          const promise = new Promise((resolve, reject) => {
              if (isUndefinedOrNull(windowTypeOrConfiguration)) {
                  reject("windowType is undefined");
              }
              let windowDefinition;
              if (isString(windowTypeOrConfiguration)) {
                  windowDefinition = { type: (windowTypeOrConfiguration), name: "", isIndependent: false, arguments: {} };
              }
              else if (windowTypeOrConfiguration instanceof WindowType) {
                  windowDefinition = {
                      type: windowTypeOrConfiguration.type || windowTypeOrConfiguration.id,
                      name: windowTypeOrConfiguration.name || windowTypeOrConfiguration.type || windowTypeOrConfiguration.id,
                      isIndependent: false
                  };
              }
              else {
                  const invalidKeys = ["url"];
                  const filteredWindowTypeOrConfiguration = {};
                  Object.keys(windowTypeOrConfiguration).forEach((key) => {
                      if (invalidKeys.indexOf(key) === -1) {
                          filteredWindowTypeOrConfiguration[key] = windowTypeOrConfiguration[key];
                      }
                  });
                  windowDefinition = filteredWindowTypeOrConfiguration;
              }
              let relativeToWindow;
              if (!isUndefinedOrNull(windowDefinition.relativeTo)) {
                  relativeToWindow = windowDefinition.relativeTo;
                  if (typeof relativeToWindow === "string") {
                      const windows = this.getWindows({ type: relativeToWindow });
                      if (!isUndefinedOrNull(windows) && windows.length > 0) {
                          windowDefinition.relativeTo = windows[0].id;
                      }
                  }
                  else if (!isUndefinedOrNull(relativeToWindow.type)) {
                      const windows = this.getWindows({ type: relativeToWindow.type });
                      if (!isUndefinedOrNull(windows) && windows.length > 0) {
                          windowDefinition.relativeTo = windows[0].id;
                      }
                  }
                  else if (!isUndefinedOrNull(relativeToWindow.windowId)) {
                      windowDefinition.relativeTo = relativeToWindow.windowId;
                  }
              }
              this._bridge.createWindow(activity && activity.id, windowDefinition)
                  .then((wid) => {
                  this._logger.debug("Window created, waiting for window entity with id " + wid);
                  const handler = (window, context) => {
                      if (window.id === wid && (!activity || window.activity)) {
                          this._logger.debug("Got entity window with id " + wid);
                          resolve(window);
                          this._windows.unsubscribe(handler);
                      }
                  };
                  this._windows.subscribe(handler);
              })
                  .catch((err) => {
                  reject(err);
              });
          });
          return nodeify(promise, callback);
      }
      createStackedWindows(activity, relativeWindowTypes, timeout, callback) {
          const promise = new Promise((resolve, reject) => {
              if (isUndefinedOrNull(activity)) {
                  reject("activity is undefined");
              }
              if (isUndefinedOrNull(relativeWindowTypes)) {
                  reject("relativeWindowTypes is undefined");
              }
              if (!Array.isArray(relativeWindowTypes)) {
                  reject("relativeWindowTypes has to be an array");
              }
              if (isUndefinedOrNull(timeout)) {
                  timeout = 20000;
              }
              const windowDefinitions = [];
              relativeWindowTypes.forEach((element) => {
                  let windowDefinition;
                  if (isString(element)) {
                      windowDefinition = { type: (element), name: "", isIndependent: false, arguments: {} };
                  }
                  else {
                      windowDefinition = (element);
                  }
                  windowDefinition.stackedWindow = true;
                  windowDefinition.timeout = timeout;
                  let relativeToWindow;
                  if (!isUndefinedOrNull(windowDefinition.relativeTo)) {
                      relativeToWindow = windowDefinition.relativeTo;
                      if (!isUndefinedOrNull(relativeToWindow.type)) {
                          windowDefinition.relativeTo = relativeToWindow.type;
                      }
                      else if (!isUndefinedOrNull(relativeToWindow.windowId)) {
                          const windows = this.getWindows({ id: relativeToWindow.windowId });
                          if (!isUndefinedOrNull(windows) && windows.length > 0) {
                              windowDefinition.relativeTo = windows[0].type.name;
                          }
                      }
                  }
                  windowDefinitions.push(windowDefinition);
              });
              const tasks = [];
              windowDefinitions.forEach((wd) => tasks.push(this.createWindow(activity, wd)));
              Promise.all(tasks).then(resolve).catch(reject);
          });
          return nodeify(promise, callback);
      }
      addWindowToActivity(activity, window, callback) {
          const toReturn = this._bridge.joinActivity(activity.id, window.id)
              .then(() => window);
          nodeify(toReturn, callback);
          return toReturn;
      }
      leaveWindowFromActivity(activity, window, callback) {
          const toReturn = this._bridge.leaveActivity(activity.id, window.id)
              .then(() => window);
          nodeify(toReturn, callback);
          return toReturn;
      }
      setActivityContext(activity, context, callback) {
          const promise = new Promise((resolve, reject) => {
              if (isUndefinedOrNull(activity)) {
                  reject("activity can not be null");
              }
              this._bridge
                  .updateActivityContext(activity, context, true)
                  .then((_) => {
                  resolve(activity);
              })
                  .catch((err) => {
                  reject(err);
              });
          });
          return nodeify(promise, callback);
      }
      updateActivityContext(activity, context, callback) {
          const promise = new Promise((resolve, reject) => {
              if (isUndefinedOrNull(activity)) {
                  reject("activity can not be null");
              }
              const removedKeys = [];
              for (const key in context) {
                  if (context.hasOwnProperty(key) && context[key] === null) {
                      removedKeys.push(key);
                  }
              }
              for (const removedKey of removedKeys) {
                  delete context[removedKey];
              }
              this._bridge
                  .updateActivityContext(activity, context, false, removedKeys)
                  .then((_) => {
                  resolve(activity);
              })
                  .catch((err) => {
                  reject(err);
              });
          });
          return nodeify(promise, callback);
      }
      subscribeActivityContextChanged(handler) {
          this._activities.subscribe((act, context) => {
              if (context.type === EntityEventType.ActivityContextChange) {
                  const updateContext = context;
                  handler(act, updateContext.context, updateContext.updated, updateContext.removed);
              }
          });
      }
      stopActivity(activity, callback) {
          const promise = this._bridge.stopActivity(activity);
          return nodeify(promise, callback);
      }
      getWindows(filter) {
          if (isUndefined(filter)) {
              return this._windows.get();
          }
          if (!isUndefined(filter.id)) {
              return [this._windows.getByName(filter.id)];
          }
          const allWindows = this._windows.get();
          return allWindows.filter((w) => {
              if (!isUndefined(filter.type) && w.type.id !== filter.type) {
                  return false;
              }
              if (!isUndefined(filter.name) && w.name !== filter.name) {
                  return false;
              }
              if (!isUndefined(filter.activityId)) {
                  if (isUndefinedOrNull(w.activity)) {
                      return false;
                  }
                  if (w.activity.id !== filter.activityId) {
                      return false;
                  }
              }
              return true;
          });
      }
      getWindowBounds(id) {
          return this._bridge.getWindowBounds(id);
      }
      setWindowBounds(id, bounds, callback) {
          const promise = new Promise((resolve, reject) => {
              this._bridge.setWindowBounds(id, bounds)
                  .then(() => resolve())
                  .catch((err) => reject(err));
          });
          return nodeify(promise, callback);
      }
      closeWindow(id) {
          return this._bridge.closeWindow(id);
      }
      activateWindow(id, focus) {
          return this._bridge.activateWindow(id, focus);
      }
      setWindowVisibility(id, visible) {
          return this._bridge.setWindowVisibility(id, visible);
      }
      clone(activity, cloneOptions, callback) {
          const promise = new Promise((resolve, reject) => {
              if (!activity) {
                  reject("activity can not be null");
              }
              this._bridge.cloneActivity(activity.id, cloneOptions)
                  .then((activityId) => {
                  this._activities
                      .getOrWait(activityId)
                      .then((act) => {
                      resolve(act);
                  })
                      .catch((err) => reject(err));
              })
                  .catch((err) => reject(err));
          });
          return nodeify(promise, callback);
      }
      attachActivities(from, to, tag, callback) {
          tag = tag || {};
          const promise = new Promise((resolve, reject) => {
              const fromActivity = this._activities.getByName(from);
              if (!fromActivity) {
                  reject("can not find activity with id " + from);
                  return;
              }
              const toActivity = this._activities.getByName(to);
              if (!toActivity) {
                  reject("can not find activity with id " + to);
                  return;
              }
              return this._bridge.attachActivities(from, to, tag)
                  .then((data) => {
                  const newActId = data.to;
                  const state = data.descriptor;
                  const allStates = data.descriptors;
                  this._activities.getOrWait(newActId).then((act) => {
                      act._updateDescriptors(allStates);
                      const stateWrapped = act.attached.filter((u) => u.ownerId === state.ownerId)[0];
                      resolve(stateWrapped);
                  });
              })
                  .catch((err) => {
                  reject(err);
              });
          });
          return nodeify(promise, callback);
      }
      detachActivities(activityId, descriptor, callback) {
          const promise = new Promise((resolve, reject) => {
              return this._bridge.detachActivities(activityId, descriptor)
                  .then(() => {
                  const oldActId = undefined;
                  const newActId = undefined;
                  const descriptors = undefined;
                  this._activities
                      .getOrWait(oldActId)
                      .then((oldAct) => {
                      oldAct._updateDescriptors(descriptors);
                      this._activities
                          .getOrWait(newActId)
                          .then((newAct) => {
                          resolve(newAct);
                      });
                  })
                      .catch((err) => reject(err));
              })
                  .catch((err) => {
                  reject(err);
              });
          });
          return nodeify(promise, callback);
      }
      subscribeActivitiesAttached(callback) {
          this._attachedCallbacks.push(callback);
      }
      subscribeActivitiesDetached(callback) {
          this._detachedCallbacks.push(callback);
      }
      subscribeActivityFrameColorChanged(callback) {
          this._frameColorChangesCallbacks.push(callback);
      }
      _grabEntity(entity) {
          entity._manager = this;
      }
      _getInitialData() {
          this._logger.debug("Request initial data...");
          this._bridge.getActivityTypes()
              .then((at) => {
              this._activityTypes.add(at);
              this._dataReadyMarker.signal("Got act types");
          })
              .catch((error) => {
              this._logger.error(error);
              this._dataReadyMarker.error("Can not initialize ActivityManager - error getting activity types -" + error);
          });
          this._bridge.getWindowTypes()
              .then((wt) => {
              this._windowTypes.add(wt);
              this._dataReadyMarker.signal("Got window types");
          })
              .catch((error) => {
              this._logger.error(error);
              this._dataReadyMarker.error("Can not initialize ActivityManager - error getting window types  " + error);
          });
          this._bridge.getActivities()
              .then((ac) => {
              this._activities.add(ac);
              this._dataReadyMarker.signal("Got activities");
          })
              .catch((error) => {
              this._logger.error(error);
              this._dataReadyMarker.error("Can not initialize ActivityManager - error getting activity instances -" + error);
          });
          this._bridge.getActivityWindows()
              .then((aw) => {
              this._windows.add(aw);
              this._dataReadyMarker.signal("Got windows");
          })
              .catch((error) => {
              this._logger.error(error);
              this._dataReadyMarker.error("Can not initialize ActivityManager - error getting activity windows -" + error);
          });
      }
      _subscribeForData() {
          this._logger.debug("Subscribe for data...");
          this._bridge.onActivityTypeStatusChange((event) => {
              this._activityTypes.process(event);
          });
          this._bridge.onWindowTypeStatusChange((event) => {
              this._windowTypes.process(event);
          });
          this._bridge.onActivityWindowChange((event) => {
              this._windows.process(event);
          });
          this._bridge.onActivityStatusChange((event) => {
              this._activities.process(event);
          });
      }
      _handleActivitiesAttached(data) {
          const newActId = data.to;
          const descriptor = data.descriptor;
          const descriptors = data.descriptors;
          this._activities.getOrWait(newActId).then((act) => {
              act._updateDescriptors(descriptors);
              const descriptorAsObjectFromAPI = act.attached.filter((u) => u.ownerId === descriptor.ownerId)[0];
              this._attachedCallbacks.forEach((callback) => {
                  try {
                      callback(act, descriptorAsObjectFromAPI);
                  }
                  catch (err) {
                      return;
                  }
              });
          });
      }
      _handleActivitiesDetached(data) {
          const oldActId = data.oldActivityId;
          const newActId = data.newActivityId;
          const descriptors = data.descriptors;
          const descriptor = data.descriptor;
          this._activities.getOrWait(oldActId).then((oldAct) => {
              oldAct._updateDescriptors(descriptors);
              this._activities.getOrWait(newActId).then((newAct) => {
                  this._detachedCallbacks.forEach((callback) => {
                      try {
                          callback(newAct, oldAct, descriptor);
                      }
                      catch (err) {
                          return;
                      }
                  });
              });
          });
      }
      _handleActivityDescriptorsRefreshed(data) {
          const id = data.id;
          const descriptors = data.descriptors;
          const act = this._activities.getByName(id);
          if (act) {
              act._updateDescriptors(descriptors);
          }
      }
      refreshDescriptors() {
          this._bridge.getAttachedDescriptors()
              .then((map) => {
              if (map) {
                  Object.keys(map).forEach((key) => {
                      const actId = key;
                      const descriptors = map[key];
                      const act = this._activities.getByName(actId);
                      if (act) {
                          act._updateDescriptors(descriptors);
                      }
                  });
              }
              this._descriptorsMarker.signal("Successfully got descriptors");
          })
              .catch((err) => {
              this._descriptorsMarker.error("failed to get descriptors - " + err);
          });
      }
      _handleWindowFrameColorChanged(win) {
          if (!win.activityId) {
              return;
          }
          const act = this._activities.getByName(win.activityId);
          if (!act) {
              return;
          }
          if (!act.owner) {
              return;
          }
          if (act.owner.underlyingWindow.id !== win.id) {
              return;
          }
          this._frameColorChangesCallbacks.forEach((callback) => {
              try {
                  callback(act, win.frameColor);
              }
              catch (e) {
                  return;
              }
          });
      }
  }

  class ActivityManagementAPI {
      constructor(manager, my) {
          this._m = manager;
          this._my = my;
          this.activityTypes = {
              get: this._getActivityTypesWrapper.bind(this),
              register: this._m.registerActivityType.bind(this._m),
              unregister: this._m.unregisterActivityType.bind(this._m),
              subscribe: this._m.subscribeActivityTypeEvents.bind(this._m),
              unsubscribe: undefined,
              initiate: this._m.initiate.bind(this._m)
          };
          this.windowTypes = {
              get: this._getWindowTypesWrapper.bind(this),
              registerFactory: this._m.registerWindowFactory.bind(this._m),
              unregisterFactory: this._m.unregisterWindowFactory.bind(this._m),
              subscribe: this._m.subscribeWindowTypeEvents.bind(this._m),
              unsubscribe: undefined
          };
          this.windows = {
              get: this._m.getWindows.bind(this._m),
              subscribe: this._m.subscribeWindowEvents.bind(this._m),
              announce: this._m.announceWindow.bind(this._m),
              unsubscribe: undefined,
              create: this._m.createWindow.bind(this._m)
          };
          this.instances = {
              get: this._m.getActivities.bind(this._m),
              subscribe: this._m.subscribeActivityEvents.bind(this._m),
              unsubscribe: undefined
          };
      }
      onAttached(callback) {
          this._m.subscribeActivitiesAttached(callback);
      }
      onDetached(callback) {
          this._m.subscribeActivitiesDetached(callback);
      }
      onActivityFrameColorChanged(callback) {
          this._m.subscribeActivityFrameColorChanged(callback);
      }
      _getActivityTypesWrapper(name) {
          if (isUndefined(name)) {
              return this._m.getActivityTypes();
          }
          return this._m.getActivityType(name);
      }
      _getWindowTypesWrapper(name) {
          if (isUndefined(name)) {
              return this._m.getWindowTypes();
          }
          return this._m.getWindowType(name);
      }
  }

  class ActivityAPI {
      constructor(manager, my) {
          this._mgr = manager;
          this._my = my;
          this.all = new ActivityManagementAPI(manager, my);
      }
      ready(callback) {
          const promise = new Promise((resolve, reject) => {
              this._mgr.ready()
                  .then(() => {
                  resolve(this);
              })
                  .catch((err) => {
                  reject(err);
              });
          });
          return nodeify(promise, callback);
      }
      get my() {
          return this._my;
      }
      get aware() {
          return this._my.window !== undefined;
      }
      get inActivity() {
          return this.aware && this._my.activity !== undefined;
      }
      get agm() {
          if (!this.aware) {
              return undefined;
          }
          if (!this.inActivity) {
              return new ActivityAGM(null);
          }
          return this._my.activity.agm;
      }
      getAvailableFrameColors() {
          return [];
      }
  }

  class ActivityModule {
      static checkIsUsingGW3Implementation(connection) {
          return connection.protocolVersion === 3;
      }
      get api() {
          return this._api;
      }
      set api(value) {
          this._api = value;
      }
      constructor(config) {
          if (!config) {
              throw new Error("config can not be null");
          }
          if (!isUndefined(config.logLevel)) {
              Logger.Level = config.logLevel;
          }
          if (!isUndefinedOrNull(config.logger)) {
              Logger.GlueLogger = config.logger;
          }
          let bridge;
          this._isUsingHCImplementation = config.gdMajorVersion === 2;
          this._isUsingGW3Implementation = ActivityModule.checkIsUsingGW3Implementation(config.connection);
          if (this._isUsingHCImplementation) {
              throw new Error("GD2 not supported");
          }
          else if (this._isUsingGW3Implementation) {
              bridge = new GW3Bridge(config);
          }
          else {
              throw new Error("Unable to instantiate activity bridge implementation");
          }
          if (!bridge) {
              throw new Error("A bridge to native activity is needed to create activity lib.");
          }
          ActivityAGM.AGM = config.agm;
          const activityManager = new ActivityManager(bridge, !config.disableAutoAnnounce, config.windows);
          const my = new ActivityMy(activityManager, config.windows);
          this._api = new ActivityAPI(activityManager, my);
          this._readyPromise = activityManager.ready().then((_) => this);
      }
      get isUsingHCImplementation() {
          return this._isUsingHCImplementation;
      }
      get isUsingGW3Implementation() {
          return this._isUsingGW3Implementation;
      }
      ready(callback) {
          return nodeify(this._readyPromise, callback);
      }
  }

  const ShutdownMethodName = "T42.ACS.Shutdown";
  const OnGDShutdownMethodName = "T42.ACS.OnGDShutdown";
  const RestartMethodName = "T42.ACS.Restart";
  const GetConfigurationRegionMethodName = "T42.ACS.GetConfigurationRegion";
  const SetConfigurationRegionMethodName = "T42.ACS.SetConfigurationRegion";
  const GetUserMethodName = "T42.ACS.GetUser";
  const GetBranchesMethodName = "T42.ACS.GetBranches";
  const GetCurrentBranchMethodName = "T42.ACS.GetCurrentBranch";
  const SetCurrentBranchMethodName = "T42.ACS.SetCurrentBranch";
  const GetFunctionalEntitlementMethodName = "T42.ACS.GetFunctionalEntitlement";
  const CanIMethodName = "T42.ACS.CanI";
  const StartApplicationMethodName = "T42.ACS.StartApplication";
  const StopApplicationMethodName = "T42.ACS.StopApplication";
  const ActivateApplicationMethodName = "T42.ACS.ActivateApplication";
  const ACSExecute = "T42.ACS.Execute";
  const OnEventMethodName = "T42.ACS.OnEvent";
  const GetApplicationsMethodName = "T42.ACS.GetApplications";

  var commonjsGlobal = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {};

  function getDefaultExportFromCjs (x) {
  	return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, 'default') ? x['default'] : x;
  }

  function createRegistry(options) {
      if (options && options.errorHandling
          && typeof options.errorHandling !== "function"
          && options.errorHandling !== "log"
          && options.errorHandling !== "silent"
          && options.errorHandling !== "throw") {
          throw new Error("Invalid options passed to createRegistry. Prop errorHandling should be [\"log\" | \"silent\" | \"throw\" | (err) => void], but " + typeof options.errorHandling + " was passed");
      }
      var _userErrorHandler = options && typeof options.errorHandling === "function" && options.errorHandling;
      var callbacks = {};
      function add(key, callback, replayArgumentsArr) {
          var callbacksForKey = callbacks[key];
          if (!callbacksForKey) {
              callbacksForKey = [];
              callbacks[key] = callbacksForKey;
          }
          callbacksForKey.push(callback);
          if (replayArgumentsArr) {
              setTimeout(function () {
                  replayArgumentsArr.forEach(function (replayArgument) {
                      var _a;
                      if ((_a = callbacks[key]) === null || _a === void 0 ? void 0 : _a.includes(callback)) {
                          try {
                              if (Array.isArray(replayArgument)) {
                                  callback.apply(undefined, replayArgument);
                              }
                              else {
                                  callback.apply(undefined, [replayArgument]);
                              }
                          }
                          catch (err) {
                              _handleError(err, key);
                          }
                      }
                  });
              }, 0);
          }
          return function () {
              var allForKey = callbacks[key];
              if (!allForKey) {
                  return;
              }
              allForKey = allForKey.reduce(function (acc, element, index) {
                  if (!(element === callback && acc.length === index)) {
                      acc.push(element);
                  }
                  return acc;
              }, []);
              if (allForKey.length === 0) {
                  delete callbacks[key];
              }
              else {
                  callbacks[key] = allForKey;
              }
          };
      }
      function execute(key) {
          var argumentsArr = [];
          for (var _i = 1; _i < arguments.length; _i++) {
              argumentsArr[_i - 1] = arguments[_i];
          }
          var callbacksForKey = callbacks[key];
          if (!callbacksForKey || callbacksForKey.length === 0) {
              return [];
          }
          var results = [];
          callbacksForKey.forEach(function (callback) {
              try {
                  var result = callback.apply(undefined, argumentsArr);
                  results.push(result);
              }
              catch (err) {
                  results.push(undefined);
                  _handleError(err, key);
              }
          });
          return results;
      }
      function _handleError(exceptionArtifact, key) {
          var errParam = exceptionArtifact instanceof Error ? exceptionArtifact : new Error(exceptionArtifact);
          if (_userErrorHandler) {
              _userErrorHandler(errParam);
              return;
          }
          var msg = "[ERROR] callback-registry: User callback for key \"" + key + "\" failed: " + errParam.stack;
          if (options) {
              switch (options.errorHandling) {
                  case "log":
                      return console.error(msg);
                  case "silent":
                      return;
                  case "throw":
                      throw new Error(msg);
              }
          }
          console.error(msg);
      }
      function clear() {
          callbacks = {};
      }
      function clearKey(key) {
          var callbacksForKey = callbacks[key];
          if (!callbacksForKey) {
              return;
          }
          delete callbacks[key];
      }
      return {
          add: add,
          execute: execute,
          clear: clear,
          clearKey: clearKey
      };
  }
  createRegistry.default = createRegistry;
  var lib = createRegistry;


  var CallbackRegistryFactory = /*@__PURE__*/getDefaultExportFromCjs(lib);

  function objectValues(source) {
      if (!source) {
          return [];
      }
      return Object.keys(source).map((key) => source[key]);
  }
  function objectClone(obj) {
      let result;
      try {
          result = JSON.parse(JSON.stringify(obj || {}));
      }
      catch (error) {
          result = {};
      }
      return result;
  }
  function validate(callback, configuration) {
      if (configuration.throwErrors) {
          if (typeof callback !== "function") {
              throw new Error("Please provide the callback as a function!");
          }
      }
  }

  const INTEROP_METHOD_RESPONSE_TIMEOUT_MS = 90000;
  const INTEROP_METHOD_WAIT_TIMEOUT_MS = 90000;

  let urlAlphabet =
    'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict';
  let nanoid = (size = 21) => {
    let id = '';
    let i = size | 0;
    while (i--) {
      id += urlAlphabet[(Math.random() * 64) | 0];
    }
    return id
  };

  class Utils {
      static getGDMajorVersion() {
          if (typeof window === "undefined") {
              return -1;
          }
          if (!window.glueDesktop) {
              return -1;
          }
          if (!window.glueDesktop.version) {
              return -1;
          }
          const parsed = window.glueDesktop.version.split(".");
          const major = Number(parsed[0]);
          return isNaN(major) ? -1 : major;
      }
      static typedError(error) {
          let err;
          if (error instanceof Error) {
              err = error;
          }
          else if (typeof error === "string") {
              err = new Error(error);
          }
          else if ("message" in error && typeof error.message === "string" && error.message.length > 0) {
              err = new Error(error.message);
          }
          else if ("returned" in error
              && typeof error.returned === "object"
              && "errorMsg" in error.returned
              && typeof error.returned.errorMsg === "string"
              && error.returned.errorMsg.length > 0) {
              err = new Error(error.returned.errorMsg);
          }
          else {
              err = new Error("Unknown error");
          }
          return err;
      }
      static async callbackifyPromise(action, successCallback, errorCallback) {
          const success = (result) => {
              if (typeof successCallback === "function") {
                  successCallback(result);
              }
              return Promise.resolve(result);
          };
          const fail = (error) => {
              const err = Utils.typedError(error);
              if (typeof errorCallback === "function") {
                  errorCallback(err.message);
                  return;
              }
              return Promise.reject(err);
          };
          try {
              const result = await action();
              return success(result);
          }
          catch (error) {
              return fail(error);
          }
      }
      static getMonitor(bounds, displays) {
          const monitorsSortedByOverlap = displays.map((m) => {
              const { left, top, workingAreaWidth: width, workingAreaHeight: height } = m;
              const overlap = this.calculateTotalOverlap({ left, top, width, height }, bounds);
              return {
                  monitor: m,
                  totalOverlap: overlap
              };
          }).sort((a, b) => b.totalOverlap - a.totalOverlap);
          return monitorsSortedByOverlap[0].monitor;
      }
      static getDisplayCenterOfScreen(a, currentDisplay, primaryDisplay) {
          const physicalWidth = a.width / currentDisplay.scaleFactor;
          const physicalHeight = a.height / currentDisplay.scaleFactor;
          const physicalDisplayLeft = currentDisplay.workArea.left / primaryDisplay.scaleFactor;
          const physicalDisplayTop = currentDisplay.workArea.top / primaryDisplay.scaleFactor;
          const physicalDisplayWidth = currentDisplay.workArea.width / currentDisplay.scaleFactor;
          const physicalDisplayHeight = currentDisplay.workArea.height / currentDisplay.scaleFactor;
          const physicalHOffset = Math.max((physicalDisplayWidth - physicalWidth) / 2, 0);
          const physicalVOffset = Math.max((physicalDisplayHeight - physicalHeight) / 2, 0);
          const centeredPhysicalLeft = Math.floor(physicalDisplayLeft + physicalHOffset);
          const centeredPhysicalTop = Math.floor(physicalDisplayTop + physicalVOffset);
          const left = centeredPhysicalLeft * primaryDisplay.scaleFactor;
          const top = centeredPhysicalTop * primaryDisplay.scaleFactor;
          return {
              left,
              top,
              width: a.width,
              height: a.height
          };
      }
      static isNode() {
          if (typeof Utils._isNode !== "undefined") {
              return Utils._isNode;
          }
          if (typeof window !== "undefined") {
              Utils._isNode = false;
              return false;
          }
          try {
              Utils._isNode = Object.prototype.toString.call(global.process) === "[object process]";
          }
          catch (e) {
              Utils._isNode = false;
          }
          return Utils._isNode;
      }
      static generateId() {
          return nanoid(10);
      }
      static isPromise(value) {
          return Boolean(value && typeof value.then === 'function');
      }
      static isAsyncFunction(value) {
          return value && {}.toString.call(value) === '[object AsyncFunction]';
      }
      static isNullOrUndefined(value) {
          return value === null || value === undefined;
      }
      static calculateTotalOverlap(r1, r2) {
          const r1x = r1.left;
          const r1y = r1.top;
          const r1xMax = r1x + r1.width;
          const r1yMax = r1y + r1.height;
          const r2x = r2.left;
          const r2y = r2.top;
          const r2xMax = r2x + r2.width;
          const r2yMax = r2y + r2.height;
          const xOverlap = Math.max(0, Math.min(r1xMax, r2xMax) - Math.max(r1x, r2x));
          const yOverlap = Math.max(0, Math.min(r1yMax, r2yMax) - Math.max(r1y, r2y));
          return xOverlap * yOverlap;
      }
  }

  class ApplicationImpl {
      constructor(_appManager, _name, _agm, _logger, _configuration) {
          this._appManager = _appManager;
          this._name = _name;
          this._agm = _agm;
          this._logger = _logger;
          this._configuration = _configuration;
          this._registry = CallbackRegistryFactory();
          _appManager.onInstanceStarted((instance) => {
              if (instance.application && instance.application.name !== this._name) {
                  return;
              }
              this._registry.execute("instanceStarted", instance);
          });
          _appManager.onInstanceStopped((instance) => {
              if (instance.application && instance.application.name !== this._name) {
                  return;
              }
              this._registry.execute("instanceStopped", instance);
          });
          _appManager.onAppRemoved((app) => {
              if (app.name !== this._name) {
                  return;
              }
              this._registry.execute("appRemoved", app);
          });
          _appManager.onAppChanged((app) => {
              if (app.name !== this._name) {
                  return;
              }
              this._registry.execute("appChanged", app);
          });
          _appManager.onAppAvailable((app) => {
              if (app.name !== this._name) {
                  return;
              }
              this._props.IsReady = true;
              this._registry.execute("appAvailable", app);
          });
          _appManager.onAppUnavailable((app) => {
              if (app.name !== this._name) {
                  return;
              }
              this._props.IsReady = false;
              this._registry.execute("appUnavailable", app);
          });
      }
      get name() { return this._name; }
      get title() { return this._props.Title; }
      get version() { return this._props.Version; }
      get autoStart() { return this._props.AutoStart; }
      get isShell() { return this._props.IsShell; }
      get caption() { return this._props.Caption; }
      get hidden() { return this._props.IsHidden; }
      get container() { return this._props.ApplicationName; }
      get activityType() { return this._props.ActivityType; }
      get activityWindowType() { return this._props.ActivityWindowType; }
      get windowSettings() {
          if (!this._props.Arguments) {
              return {};
          }
          return objectClone(this._props.Arguments);
      }
      get allowMultiple() { return this._props.AllowMultiple; }
      get available() { return this._props.IsReady || true; }
      get icon() { return this._props.Icon; }
      get iconURL() { return this._props.IconUrl; }
      get sortOrder() { return this._props.SortOrder; }
      get userProperties() {
          if (!this._props.UserProperties) {
              return {};
          }
          return objectClone(this._props.UserProperties);
      }
      get keywords() {
          if (!this._props.Keywords) {
              return [];
          }
          return this._props.Keywords;
      }
      get isActivity() {
          return this._props.ActivityType !== undefined && this._props.ActivityType !== "";
      }
      get configuration() {
          return {
              autoStart: this._props.AutoStart,
              caption: this._props.Caption,
              hidden: this._props.IsHidden,
              container: this._props.ApplicationName,
              activityType: this._props.ActivityType,
              allowMultiple: this._props.AllowMultiple
          };
      }
      get instances() {
          return this._appManager.instances().filter((instance) => instance.application.name === this._name);
      }
      get type() {
          return this._props.Type;
      }
      get mode() {
          if (!this._props) {
              return "unknown";
          }
          if (this._props.Mode && typeof this._props.Mode === "string") {
              return this._props.Mode.toLowerCase();
          }
          if (this.isActivity) {
              return "unknown";
          }
          if (this._props.Arguments && this._props.Arguments.mode && typeof this._props.Arguments.mode === "string") {
              return this._props.Arguments.mode.toLowerCase();
          }
          let styleAttributes = this._props.WindowStyleAttributes;
          if (styleAttributes) {
              styleAttributes = styleAttributes.split(" ").join("");
              const searchFor = "mode:\"";
              const modeIndex = styleAttributes.indexOf(searchFor);
              if (modeIndex !== -1) {
                  const startModeIndex = modeIndex + searchFor.length;
                  const stopModeIndex = styleAttributes.indexOf("\"", startModeIndex);
                  const style = styleAttributes.substr(startModeIndex, stopModeIndex - startModeIndex);
                  if (style && typeof style === "string") {
                      return style.toLowerCase();
                  }
              }
          }
          return "flat";
      }
      async getConfiguration() {
          const result = await this._agm.invoke(GetApplicationsMethodName, { v2: { apps: [this._name] } }, "best", {
              waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
              methodResponseTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS
          });
          const config = result.returned.applications[0];
          return config;
      }
      updateFromProps(props) {
          if (!this._props) {
              this._props = { Name: props.Name };
          }
          Object.keys(props).forEach((key) => {
              this._props[key] = props[key];
          });
      }
      start(context, options) {
          return new Promise(async (resolve, reject) => {
              var _a, _b, _c, _d;
              if (isUndefinedOrNull(context)) {
                  context = {};
              }
              else if (((_a = this._configuration()) === null || _a === void 0 ? void 0 : _a.throwErrors) && typeof context !== "object" || Array.isArray(context)) {
                  return reject(new Error(`Invalid "context" parameter - must be an object.`));
              }
              if (isUndefinedOrNull(options)) {
                  options = {};
              }
              else if (((_b = this._configuration()) === null || _b === void 0 ? void 0 : _b.throwErrors) && typeof options !== "object") {
                  return reject(new Error(`Invalid "options" parameter - must be an object.`));
              }
              const name = this._name;
              let waitForAGMInstance = (_d = ((_c = options.awaitInterop) !== null && _c !== void 0 ? _c : options.waitForAGMReady)) !== null && _d !== void 0 ? _d : true;
              let startTimeout = 60000;
              if (typeof options.timeout === "number") {
                  startTimeout = options.timeout * 1000;
              }
              if (options.relativeTo !== undefined && typeof options.relativeTo !== "string") {
                  options.relativeTo = options.relativeTo.id || "";
              }
              const waitForApplicationInstance = (id) => {
                  let unsub;
                  const timeout = setTimeout(() => {
                      if (unsub) {
                          unsub();
                      }
                      const errMsg = `timed out while waiting for instance id ${id} for app ${this.name}`;
                      this._logger.error(errMsg);
                      reject(new Error(errMsg));
                  }, startTimeout);
                  const waitFunc = (i) => {
                      if (i.id !== id) {
                          return;
                      }
                      if (unsub) {
                          unsub();
                          unsub = undefined;
                      }
                      clearTimeout(timeout);
                      resolve(i);
                  };
                  if (waitForAGMInstance) {
                      const instance = this._appManager.instances().find((i) => i.id === id);
                      if (instance) {
                          unsub = instance.onAgmReady(waitFunc);
                      }
                      else {
                          unsub = this._appManager.onInstanceAgmServerReady(waitFunc);
                      }
                  }
                  else {
                      unsub = this._appManager.onInstanceStarted(waitFunc);
                  }
              };
              try {
                  this._logger.trace(`starting application ${name} with options: ${JSON.stringify(options)}`);
                  const result = await this._agm.invoke(StartApplicationMethodName, {
                      Name: name,
                      Context: context,
                      Options: options
                  }, "best", {
                      methodResponseTimeoutMs: startTimeout,
                      waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS
                  });
                  const acsResult = result.returned;
                  if (typeof acsResult.timeout !== "undefined" && typeof options.timeout === "undefined") {
                      startTimeout = acsResult.timeout * 1000;
                  }
                  if (typeof acsResult.waitForInterop !== "undefined" && (typeof options.waitForAGMReady === "undefined" && typeof options.awaitInterop === "undefined")) {
                      waitForAGMInstance = acsResult.waitForInterop;
                  }
                  if (acsResult && acsResult.Id) {
                      if (this._appManager.mode === "startOnly") {
                          const instance = this._appManager.handleInstanceStarted({
                              ActivityId: undefined,
                              IsActivityOwner: undefined,
                              Context: undefined,
                              Title: undefined,
                              AgmServers: undefined,
                              Id: acsResult.Id,
                              Name: acsResult.Name,
                          });
                          resolve(instance);
                      }
                      else {
                          waitForApplicationInstance(acsResult.Id);
                      }
                  }
                  else {
                      resolve(undefined);
                  }
              }
              catch (error) {
                  const err = Utils.typedError(error);
                  reject(err);
              }
          });
      }
      onInstanceStarted(callback) {
          validate(callback, this._configuration());
          return this._registry.add("instanceStarted", callback);
      }
      onInstanceStopped(callback) {
          validate(callback, this._configuration());
          return this._registry.add("instanceStopped", callback);
      }
      onAvailable(callback) {
          validate(callback, this._configuration());
          if (this._props.IsReady) {
              setTimeout(() => {
                  this._registry.execute("appAvailable", this);
              }, 0);
          }
          return this._registry.add("appAvailable", callback);
      }
      onUnavailable(callback) {
          validate(callback, this._configuration());
          if (this._props.IsReady === false) {
              setTimeout(() => {
                  this._registry.execute("appUnavailable", this);
              }, 0);
          }
          return this._registry.add("appUnavailable", callback);
      }
      onChanged(callback) {
          validate(callback, this._configuration());
          this._registry.add("appChanged", callback);
      }
      onRemoved(callback) {
          validate(callback, this._configuration());
          this._registry.add("appRemoved", callback);
      }
  }

  class InstanceImpl {
      constructor(_id, _appName, _appManager, _agm, _activities, _windows, _logger, startFailed, _configuration) {
          this._id = _id;
          this._appName = _appName;
          this._appManager = _appManager;
          this._agm = _agm;
          this._activities = _activities;
          this._windows = _windows;
          this._logger = _logger;
          this._configuration = _configuration;
          this._registry = CallbackRegistryFactory();
          if (startFailed) {
              return;
          }
          this._unsubscribeInstanceStopped = this._appManager.onInstanceStopped((instance) => {
              if (instance.id !== this._id) {
                  return;
              }
              this._registry.execute("stopped", instance);
          });
          this._unsubscribeInstanceAgmServerReady = this._appManager.onInstanceAgmServerReady((instance) => {
              if (instance.id !== this._id) {
                  return;
              }
              this._registry.execute("agmReady", instance);
          });
      }
      get id() { return this._id; }
      get application() { return this._appManager.application(this._appName); }
      get activity() {
          if (!this._activities) {
              throw new Error("This method requires glue.activities library to be enabled.");
          }
          return this._activities.all.instances.get()
              .filter((activityInstance) => activityInstance.id === this._activityId)[0];
      }
      get isActivityOwner() { return this._isActivityOwner; }
      get activityInstances() {
          return this._appManager.instances().filter((i) => i.application.type !== "activity" &&
              i.activityId &&
              i.activityId === this._activityId);
      }
      get activityOwnerInstance() {
          if (!this._activityId) {
              return undefined;
          }
          return this.activityInstances.filter((inst) => inst === null || inst === void 0 ? void 0 : inst.isActivityOwner)[0];
      }
      get window() {
          if (!this._windows) {
              throw new Error("This method requires glue.windows library to be enabled.");
          }
          let win = this._windows.list().find((w) => w.id === this._id);
          if (!win && this._activities && this.activity && this.activityOwnerInstance) {
              win = this.activityOwnerInstance.window;
          }
          return win;
      }
      get context() {
          var _a, _b, _c;
          return (_c = (_a = this._startUpContext) !== null && _a !== void 0 ? _a : (_b = this.window) === null || _b === void 0 ? void 0 : _b.context) !== null && _c !== void 0 ? _c : {};
      }
      get title() { return this._title; }
      get isActivityInstance() { return this._isActivityInstance; }
      get activityId() { return this._activityId; }
      get inActivity() { return this._inActivity; }
      get isSingleWindowApp() { return !this._inActivity; }
      get agm() {
          return this._agmInstance;
      }
      get interopInstance() {
          return this._agmInstance;
      }
      onInteropReady(callback) {
          validate(callback, this._configuration());
          if (this._agmInstance) {
              setTimeout(() => {
                  this._registry.execute("agmReady", this);
              }, 0);
          }
          return this._registry.add("agmReady", callback);
      }
      onAgmReady(callback) {
          return this.onInteropReady(callback);
      }
      onStopped(callback) {
          validate(callback, this._configuration());
          return this._registry.add("stopped", callback);
      }
      getWindow() {
          return new Promise((resolve, reject) => {
              const result = this.window;
              if (result) {
                  resolve(result);
                  return;
              }
              const done = (error, window) => {
                  if (error) {
                      reject(error);
                  }
                  if (window) {
                      resolve(window);
                  }
                  setTimeout(() => {
                      clearTimeout(timeout);
                      unsub();
                  }, 0);
              };
              this._logger.trace(`waiting for window with id ${this._id} to appear`);
              const timeoutInSeconds = 60;
              const timeout = setTimeout(() => {
                  this._logger.trace(`window with id ${this._id} did not appear in ${timeoutInSeconds} sec`);
                  done(new Error(`can not find a window with id ${this._id}`));
              }, timeoutInSeconds * 1000);
              const unsub = this._windows.onWindowAdded((w) => {
                  if (w.id === this._id) {
                      this._logger.trace(`window with id ${this._id} appeared`);
                      done(undefined, w);
                  }
              });
          });
      }
      updateFromProps(props) {
          this._startUpContext = props.Context;
          this._title = props.Title;
          this._isActivityInstance = false;
          if (props.ActivityId && props.ActivityId !== "") {
              this._activityId = props.ActivityId;
              this._isActivityInstance = true;
          }
          this._isActivityOwner = props.IsActivityOwner;
          if (!this._activityId && this._startUpContext && this._startUpContext.activityId) {
              this._activityId = this._startUpContext.activityId;
          }
          this._inActivity = Boolean(this._activityId);
          this.updateAgmInstanceFromProps(props);
      }
      updateAgmInstanceFromProps(props) {
          if (!props.AgmServers) {
              return;
          }
          const agmInstances = props.AgmServers;
          if (agmInstances && agmInstances.length > 0 && !isUndefinedOrNull(agmInstances[0])) {
              this._agmInstance = agmInstances[0];
          }
      }
      stop() {
          return new Promise((resolve, reject) => {
              let idToResolve = this._id;
              if (this.isActivityOwner) {
                  idToResolve = this.activityId;
              }
              const unsubscribe = this._appManager.onInstanceStopped((instance) => {
                  if (instance.id === idToResolve) {
                      this._logger.trace(`instance with id ${idToResolve} stopped`);
                      unsubscribe();
                      resolve();
                  }
              });
              this._logger.trace(`stopping instance with id ${this._id}`);
              this._agm.invoke(StopApplicationMethodName, {
                  Name: this._appName,
                  Id: this._id
              }, "best", {
                  waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
                  methodResponseTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS
              })
                  .then(() => {
                  if (this._appManager.mode === "startOnly") {
                      this._appManager.handleInstanceStopped({
                          Name: this._appName,
                          Id: this.id
                      });
                      resolve();
                  }
              })
                  .catch((err) => reject(err));
          });
      }
      activate() {
          return this._agm.invoke(ActivateApplicationMethodName, { Name: this._appName, Id: this._id }, "best", {
              waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
              methodResponseTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS
          });
      }
      done() {
          this._registry.clear();
          this._unsubscribeInstanceAgmServerReady();
          this._unsubscribeInstanceStopped();
      }
      getContext() {
          return Promise.resolve(this.context);
      }
      async startedBy() {
          const result = await this._agm.invoke(ACSExecute, { command: "getStartedBy", Name: this._appName, Id: this._id }, "best", {
              waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
              methodResponseTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS
          });
          return result.returned;
      }
  }

  class AppManagerImpl {
      constructor(mode, _agm, _activities, _windows, _logger, _gdMajorVersion, _configuration) {
          this.mode = mode;
          this._agm = _agm;
          this._activities = _activities;
          this._windows = _windows;
          this._logger = _logger;
          this._gdMajorVersion = _gdMajorVersion;
          this._configuration = _configuration;
          this._apps = {};
          this._instances = [];
          this._registry = CallbackRegistryFactory();
          this.getConfigurations = async (apps) => {
              const args = {
                  v2: {
                      apps: undefined
                  }
              };
              if (Array.isArray(apps)) {
                  args.v2 = {
                      apps
                  };
              }
              const result = await this._agm.invoke(GetApplicationsMethodName, args, "best", {
                  waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
                  methodResponseTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS
              });
              return result.returned.applications;
          };
          this.application = (name) => {
              var _a;
              if (((_a = this._configuration()) === null || _a === void 0 ? void 0 : _a.throwErrors) && typeof name !== "string" || isNullOrWhiteSpace(name)) {
                  throw new Error(`"name" must be string`);
              }
              return this._apps[name];
          };
          this.applications = () => {
              return Object.keys(this._apps).map((k) => this._apps[k]);
          };
          this.instances = () => {
              return this._instances.map((i) => i);
          };
          this.getMyInstance = () => {
              const glue42gd = typeof window !== "undefined" && window.glue42gd;
              if (glue42gd) {
                  if (this._gdMajorVersion >= 3) {
                      const instanceId = glue42gd.appInstanceId;
                      return this._instances.find((i) => i.id === instanceId);
                  }
              }
              else {
                  const instanceId = this._agm.instance.instance;
                  return this._instances.find((i) => i.id === instanceId);
              }
              return undefined;
          };
          this.getMyApplication = () => {
              var _a;
              if (this._agm.instance) {
                  return (_a = this.application(this._agm.instance.applicationName)) !== null && _a !== void 0 ? _a : this.application(this._agm.instance.application);
              }
          };
          this.handleSnapshotAppsAdded = (newApps) => {
              const currentApps = this.applications();
              if (currentApps.length > 0) {
                  currentApps.forEach((item) => {
                      const name = item.name;
                      const alreadyExists = newApps.find((i) => i.Name === item.name);
                      if (!alreadyExists) {
                          this.handleAppRemoved({ Name: name });
                      }
                  });
              }
              newApps.forEach((item) => {
                  const alreadyExists = currentApps.find((i) => i.name === item.Name);
                  if (!alreadyExists) {
                      this.handleAppAdded(item);
                  }
              });
          };
          this.handleSnapshotInstanceStarted = (newInstances) => {
              const currentInstances = this.instances();
              if (currentInstances.length > 0) {
                  currentInstances.forEach((item) => {
                      const id = item.id;
                      const alreadyExists = newInstances.find((i) => i.Id === id);
                      if (!alreadyExists) {
                          this.handleInstanceStopped({ Name: item.application.name, Id: id });
                      }
                  });
              }
              newInstances.forEach((item) => {
                  const alreadyExists = currentInstances.find((i) => i.id === item.Id);
                  if (!alreadyExists) {
                      this.handleInstanceStarted(item);
                  }
              });
          };
          this.handleAppAdded = (props) => {
              const id = this._getAppId(props);
              this._logger.trace(`adding app ${id}`);
              this._apps[id] = new ApplicationImpl(this, id, this._agm, this._logger, this._configuration);
              const app = this._updateAppFromProps(props);
              this._registry.execute("appAdded", app);
              this._registry.execute("appAvailable", app);
          };
          this.handleAppUpdated = (props) => {
              const app = this._updateAppFromProps(props);
              this._registry.execute("appChanged", app);
          };
          this.handleAppRemoved = (props) => {
              const id = this._getAppId(props);
              this._logger.trace(`removing app ${id}`);
              const app = this.application(id);
              this._instances = this._instances.filter((i) => i.application.name !== app.name);
              delete this._apps[id];
              this._registry.execute("appRemoved", app);
          };
          this.handleAppReady = (props) => {
              const id = this._getAppId(props);
              const app = this._getAppOrThrow(id);
              app.updateFromProps(props);
              if (app.available) {
                  this._registry.execute("appAvailable", app);
              }
              else {
                  this._registry.execute("appUnavailable", app);
              }
          };
          this.handleInstanceStarted = (props) => {
              this._logger.trace(`started app ${props.Name} ${props.Id}`);
              const id = this._getInstanceId(props);
              const appName = this._getInstanceAppName(props);
              const instance = new InstanceImpl(id, appName, this, this._agm, this._activities, this._windows, this._logger, false, this._configuration);
              this._updateInstanceFromProps(instance, props);
              this._instances.push(instance);
              this._registry.execute("instanceStarted", instance);
              return instance;
          };
          this.handleInstanceStopped = (props) => {
              this._logger.trace(`instance stopped ${props.Name} ${props.Id}`);
              const id = this._getInstanceId(props);
              const appName = this._getInstanceAppName(props);
              const instance = this._getInstanceOrThrow(id, appName);
              this._instances = this._instances.filter((i) => !this._matchInstance(i, id, appName));
              this._registry.execute("instanceStopped", instance);
              instance.done();
          };
          this.handleInstanceAgmServerReady = (props) => {
              this._logger.trace(`instance interop server ready ${props.Name} ${props.Id}`);
              const id = this._getInstanceId(props);
              const appName = this._getInstanceAppName(props);
              const instance = this._getInstanceOrThrow(id, appName);
              instance.updateAgmInstanceFromProps(props);
              this._registry.execute("instanceAgmServerReady", instance);
          };
          this.handleInstanceStartFailed = (props) => {
              const id = this._getInstanceId(props);
              const appName = this._getInstanceAppName(props);
              const startFailed = true;
              const instance = new InstanceImpl(id, appName, undefined, undefined, undefined, undefined, this._logger, startFailed, this._configuration);
              this._updateInstanceFromProps(instance, props);
              this._registry.execute("instanceStartFailed", instance);
          };
          this.handleInstanceUpdated = (props) => {
              const id = this._getInstanceId(props);
              const app = this._getInstanceAppName(props);
              const instance = this._getInstanceOrThrow(id, app);
              this._updateInstanceFromProps(instance, props);
          };
          this.onInstanceStarted = (callback) => {
              validate(callback, this._configuration());
              return this._registry.add("instanceStarted", callback, this._instances);
          };
          this.onInstanceStartFailed = (callback) => {
              validate(callback, this._configuration());
              return this._registry.add("instanceStartFailed", callback);
          };
          this.onInstanceStopped = (callback) => {
              validate(callback, this._configuration());
              return this._registry.add("instanceStopped", callback);
          };
          this.onInstanceUpdated = (callback) => {
              validate(callback, this._configuration());
              return this._registry.add("instanceChanged", callback);
          };
          this.onInstanceAgmServerReady = (callback) => {
              validate(callback, this._configuration());
              return this._registry.add("instanceAgmServerReady", callback);
          };
          this.onAppAdded = (callback) => {
              validate(callback, this._configuration());
              return this._registry.add("appAdded", callback, Object.values(this._apps));
          };
          this.onAppRemoved = (callback) => {
              validate(callback, this._configuration());
              return this._registry.add("appRemoved", callback);
          };
          this.onAppAvailable = (callback) => {
              validate(callback, this._configuration());
              return this._registry.add("appAvailable", callback);
          };
          this.onAppUnavailable = (callback) => {
              validate(callback, this._configuration());
              return this._registry.add("appUnavailable", callback);
          };
          this.onAppChanged = (callback) => {
              validate(callback, this._configuration());
              return this._registry.add("appChanged", callback);
          };
      }
      _getAppOrThrow(id) {
          const result = this.application(id);
          if (!result) {
              throw Error(`app with id ${id} not found`);
          }
          return result;
      }
      _getAppId(props) {
          return props.Name;
      }
      _matchInstance(instance, id, appName) {
          return instance.id === id && instance.application.name === appName;
      }
      _getInstanceByIdAndName(id, appName) {
          return this._instances.filter((i) => this._matchInstance(i, id, appName))[0];
      }
      _getInstanceOrThrow(id, appName) {
          const result = this._getInstanceByIdAndName(id, appName);
          if (!result) {
              throw Error(`instance with id ${id} not found`);
          }
          return result;
      }
      _getInstanceId(props) {
          return props.Id;
      }
      _getInstanceAppName(props) {
          return props.Name;
      }
      _updateAppFromProps(props) {
          const id = this._getAppId(props);
          this._logger.trace(`updating app with  + ${id}, ${JSON.stringify(props)}`);
          const app = this._getAppOrThrow(id);
          app.updateFromProps(props);
          return app;
      }
      _updateInstanceFromProps(instance, props) {
          this._logger.trace("updating instance with " + this._getInstanceId(props) + " for app " + this._getInstanceAppName(props));
          instance.updateFromProps(props);
      }
  }

  function promisify(promise, successCallback, errorCallback) {
      const isFunction = (arg) => {
          return !!(arg && arg.constructor && arg.call && arg.apply);
      };
      if (!isFunction(successCallback) && !isFunction(errorCallback)) {
          return promise;
      }
      if (!isFunction(successCallback)) {
          successCallback = () => {
          };
      }
      else if (!isFunction(errorCallback)) {
          errorCallback = () => {
          };
      }
      return promise.then(successCallback, errorCallback);
  }
  class EntitlementsImpl {
      constructor(_agm) {
          this._agm = _agm;
          this._registry = CallbackRegistryFactory();
          this._isMethodRegistered = false;
          this.handleBranchModified = (branch) => {
              this._registry.execute("branchChanged", branch);
          };
          this.handleBranchesModified = (branches) => {
              this._registry.execute("branchesChanged", branches);
          };
          this.getRegion = (success, error) => {
              return promisify(this._agmInvoke(GetConfigurationRegionMethodName, (e) => e.returned.Region), success, error);
          };
          this.getBranches = (success, error) => {
              const promise = this._agmInvoke(GetBranchesMethodName, (e) => {
                  const obj = e.returned.Branches;
                  return Object.keys(obj).map((key) => obj[key]);
              });
              return promisify(promise, success, error);
          };
          this.getCurrentBranch = (success, error) => {
              const promise = this._agmInvoke(GetCurrentBranchMethodName, (e) => e.returned.Branch, undefined);
              return promisify(promise, success, error);
          };
          this.setRegion = (region, success, error) => {
              const promise = this._agmInvoke(SetConfigurationRegionMethodName, (e) => e.returned.ResultMessage, { Region: region });
              return promisify(promise, success, error);
          };
          this.setCurrentBranch = (branch, success, error) => {
              const promise = this._agmInvoke(SetCurrentBranchMethodName, (e) => e.returned.ResultMessage, { Branch: branch });
              return promisify(promise, success, error);
          };
          this.currentUser = (success, error) => {
              const promise = this._agmInvoke(GetUserMethodName);
              return promisify(promise, success, error);
          };
          this.getFunctionalEntitlement = (funct, success, error) => {
              const promise = this._agmInvoke(GetFunctionalEntitlementMethodName, (e) => e.returned.Entitlement, { Function: funct });
              return promisify(promise, success, error);
          };
          this.getFunctionalEntitlementBranch = (funct, branch, success, error) => {
              const promise = this._agmInvoke(GetFunctionalEntitlementMethodName, (e) => e.returned.Entitlement, { Function: funct, Branch: branch });
              return promisify(promise, success, error);
          };
          this.canI = (func, success, error) => {
              const promise = this._agmInvoke(CanIMethodName, (e) => e.returned.Result, { Function: func });
              return promisify(promise, success, error);
          };
          this.canIBranch = (func, branch, success, error) => {
              const promise = this._agmInvoke(CanIMethodName, (e) => e.returned.Result, { Function: func, Branch: branch });
              return promisify(promise, success, error);
          };
          this.onBranchesChanged = (callback) => {
              return this._registry.add("branchesChanged", callback);
          };
          this.onBranchChanged = (callback) => {
              return this._registry.add("branchChanged", callback);
          };
          this.exit = (options) => {
              return this._agmInvoke(ShutdownMethodName, null, options);
          };
          this.onShuttingDown = (callback) => {
              this.registerMethod();
              return this._registry.add("onShuttingDown", callback);
          };
          this.restart = (options) => {
              return this._agmInvoke(RestartMethodName, null, options);
          };
          this._agmInvoke = (method, transformFunction, args) => {
              args = args || {};
              return new Promise((resolve, reject) => {
                  const errHandler = (error) => reject(error);
                  this._agm.invoke(method, args, "best", {
                      waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
                      methodResponseTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS
                  })
                      .then((result) => {
                      if (!transformFunction) {
                          transformFunction = (d) => d.returned;
                      }
                      resolve(transformFunction(result));
                  })
                      .catch(errHandler);
              });
          };
      }
      registerMethod() {
          if (!this._isMethodRegistered) {
              this._agm.register(OnGDShutdownMethodName, async (args) => {
                  try {
                      const results = await Promise.all(this._registry.execute("onShuttingDown", args));
                      const prevent = results.some((r) => r.prevent);
                      return { prevent };
                  }
                  catch (error) {
                  }
              });
              this._isMethodRegistered = true;
          }
      }
  }

  function snapshot(interop, appManager) {
      return new Promise((resolve, reject) => {
          interop.invoke(GetApplicationsMethodName, { skipIcon: true }, "best", {
              waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
              methodResponseTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS
          })
              .then((response) => {
              var _a;
              const data = response.returned;
              const configuration = (_a = response.returned.configuration) !== null && _a !== void 0 ? _a : {};
              if (!data) {
                  resolve(configuration);
              }
              const applications = data.applications;
              if (!applications) {
                  resolve(configuration);
              }
              objectValues(applications).map((item) => appManager.handleAppAdded(item));
              resolve(configuration);
          })
              .catch((err) => reject(new Error(`Error getting application snapshot: ${err.message}`)));
      });
  }

  const OnBranchChangedEvent = "OnBranchChanged";
  const OnBranchesModifiedEvent = "OnBranchesModified";
  const OnApplicationAddedEvent = "OnApplicationAdded";
  const OnApplicationRemovedEvent = "OnApplicationRemoved";
  const OnApplicationChangedEvent = "OnApplicationChanged";
  const OnApplicationReadyEvent = "OnApplicationReady";
  const OnApplicationStartedEvent = "OnApplicationStarted";
  const OnApplicationAgmServerReadyEvent = "OnApplicationAgmServerReady";
  const OnApplicationUpdatedEvent = "OnApplicationUpdated";
  const OnApplicationStoppedEvent = "OnApplicationStopped";
  const OnApplicationStartFailedEvent = "OnApplicationStartFailed";

  function createDataSubscription(agm, applications, entitlements, skipIcons) {
      let subscription;
      let initiated = false;
      const start = () => {
          let resolveFunc;
          let rejectFunc;
          const resultPromise = new Promise((resolve, reject) => {
              resolveFunc = resolve;
              rejectFunc = reject;
          });
          agm.subscribe(OnEventMethodName, { arguments: { skipIcon: skipIcons }, waitTimeoutMs: 10000 })
              .then((s) => {
              subscription = s;
              subscription.onData((streamData) => {
                  var _a;
                  const events = streamData.data;
                  const configuration = (_a = events.configuration) !== null && _a !== void 0 ? _a : {};
                  const onApplicationAddedEventArgs = objectValues(events[OnApplicationAddedEvent]);
                  if (streamData.data.isSnapshot) {
                      applications.handleSnapshotAppsAdded(onApplicationAddedEventArgs);
                  }
                  else {
                      onApplicationAddedEventArgs.forEach((item) => applications.handleAppAdded(item));
                  }
                  objectValues(events[OnApplicationChangedEvent])
                      .forEach((item) => applications.handleAppUpdated(item));
                  objectValues(events[OnApplicationRemovedEvent])
                      .forEach((item) => applications.handleAppRemoved(item));
                  objectValues(events[OnApplicationReadyEvent])
                      .forEach((item) => applications.handleAppReady(item));
                  const onApplicationStartedEventArgs = objectValues(events[OnApplicationStartedEvent]);
                  if (streamData.data.isSnapshot) {
                      applications.handleSnapshotInstanceStarted(onApplicationStartedEventArgs);
                  }
                  else {
                      onApplicationStartedEventArgs.forEach((item) => applications.handleInstanceStarted(item));
                  }
                  objectValues(events[OnApplicationStartFailedEvent])
                      .forEach((item) => applications.handleInstanceStartFailed(item));
                  objectValues(events[OnApplicationStoppedEvent])
                      .forEach((item) => applications.handleInstanceStopped(item));
                  objectValues(events[OnApplicationUpdatedEvent])
                      .forEach((item) => applications.handleInstanceUpdated(item));
                  objectValues(events[OnApplicationAgmServerReadyEvent])
                      .forEach((item) => applications.handleInstanceAgmServerReady(item));
                  objectValues(events[OnBranchChangedEvent])
                      .forEach((item) => entitlements.handleBranchModified(item));
                  objectValues(events[OnBranchesModifiedEvent])
                      .forEach((item) => entitlements.handleBranchesModified(item));
                  if (!initiated) {
                      initiated = true;
                      const hasMyAppInSnapShot = onApplicationAddedEventArgs.some((a) => a.Name === agm.instance.application);
                      const hasMyInstanceInSnapShot = onApplicationStartedEventArgs.some((i) => i.Id === agm.instance.instance);
                      if (hasMyAppInSnapShot) {
                          if (hasMyInstanceInSnapShot) {
                              resolveFunc(configuration);
                          }
                          else {
                              const un = applications.onInstanceStarted((i) => {
                                  if (i.id === agm.instance.instance) {
                                      un();
                                      resolveFunc(configuration);
                                  }
                              });
                          }
                      }
                      else {
                          resolveFunc(configuration);
                      }
                  }
              });
              subscription.onFailed((err) => rejectFunc(err));
          })
              .catch((err) => { var _a; return rejectFunc(`Error subscribing for ${OnEventMethodName} stream. Err: ${(_a = err.message) !== null && _a !== void 0 ? _a : JSON.stringify(err)}`); });
          return resultPromise;
      };
      const stop = () => {
          if (subscription) {
              subscription.close();
          }
      };
      return {
          start,
          stop
      };
  }

  const InMemoryStoreCommandMethodName = "T42.ACS.InMemoryStoreCommand";
  class InMemoryStore {
      constructor(interop) {
          this.interop = interop;
      }
      import(apps, mode) {
          if (!apps || !Array.isArray(apps)) {
              return Promise.reject(new Error("invalid apps argument - should be an array of application definitions"));
          }
          if (mode && mode !== "replace" && mode !== "merge") {
              return Promise.reject(new Error("invalid mode argument - should be 'replace' or 'merge'"));
          }
          mode = mode !== null && mode !== void 0 ? mode : "replace";
          const command = {
              command: "import",
              args: {
                  apps,
                  mode
              }
          };
          return this.interop.invoke(InMemoryStoreCommandMethodName, command, "best", {
              waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
              methodResponseTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS
          })
              .then((r) => r.returned);
      }
      export() {
          return this.interop.invoke(InMemoryStoreCommandMethodName, { command: "export" }, "best", {
              waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
              methodResponseTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS
          })
              .then((r) => r.returned.apps);
      }
      remove(app) {
          if (!app || typeof app !== "string") {
              return Promise.reject(new Error("invalid app name, should be a string value"));
          }
          const command = {
              command: "remove",
              args: {
                  apps: [app]
              }
          };
          return this.interop.invoke(InMemoryStoreCommandMethodName, command, "best", {
              waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
              methodResponseTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS
          }).then((r) => r.returned);
      }
      clear() {
          const command = {
              command: "clear"
          };
          return this.interop.invoke(InMemoryStoreCommandMethodName, command, "best", {
              waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
              methodResponseTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS
          }).then((r) => r.returned);
      }
      createAppDef(name, url) {
          if (!url) {
              url = "https://google.com";
          }
          return {
              name,
              type: "window",
              title: name,
              details: {
                  url
              }
          };
      }
  }

  var AppManagerFactory = (config) => {
      if (!config) {
          throw Error("config not set");
      }
      if (!config.agm) {
          throw Error("config.agm is missing");
      }
      const START_ONLY = "startOnly";
      const SKIP_ICONS = "skipIcons";
      const FULL = "full";
      const mode = config.mode || START_ONLY;
      if (mode !== START_ONLY && mode !== SKIP_ICONS && mode !== FULL) {
          throw new Error(`Invalid mode for appManager lib - ${mode} is not supported`);
      }
      const activities = config.activities;
      const agm = config.agm;
      const logger = config.logger;
      const windows = config.windows;
      let configuration = {};
      const appManager = new AppManagerImpl(mode, agm, activities, windows, logger.subLogger("applications"), config.gdMajorVersion, () => configuration);
      const entitlements = new EntitlementsImpl(agm);
      let readyPromise;
      if (mode === START_ONLY) {
          readyPromise = snapshot(agm, appManager);
      }
      else {
          const subscription = createDataSubscription(agm, appManager, entitlements, mode === SKIP_ICONS);
          readyPromise = subscription.start();
      }
      const api = {
          ready: () => readyPromise.then((c) => { configuration = c; }),
          applications: appManager.applications,
          application: appManager.application,
          getConfigurations: appManager.getConfigurations,
          onAppAdded: appManager.onAppAdded,
          onAppRemoved: appManager.onAppRemoved,
          onAppChanged: appManager.onAppChanged,
          onAppAvailable: appManager.onAppAvailable,
          onAppUnavailable: appManager.onAppUnavailable,
          instances: appManager.instances,
          get myInstance() {
              return appManager.getMyInstance();
          },
          get myApplication() {
              return appManager.getMyApplication();
          },
          onInstanceStarted: appManager.onInstanceStarted,
          onInstanceStopped: appManager.onInstanceStopped,
          onInstanceUpdated: appManager.onInstanceUpdated,
          onInstanceStartFailed: appManager.onInstanceStartFailed,
          getRegion: entitlements.getRegion,
          getBranches: entitlements.getBranches,
          getCurrentBranch: entitlements.getCurrentBranch,
          getFunctionalEntitlement: entitlements.getFunctionalEntitlement,
          getFunctionalEntitlementBranch: entitlements.getFunctionalEntitlementBranch,
          setCurrentBranch: entitlements.setCurrentBranch,
          setRegion: entitlements.setRegion,
          currentUser: entitlements.currentUser,
          canI: entitlements.canI,
          canIBranch: entitlements.canIBranch,
          onBranchesChanged: entitlements.onBranchesChanged,
          exit: entitlements.exit,
          restart: entitlements.restart,
          onShuttingDown: entitlements.onShuttingDown,
          inMemory: new InMemoryStore(agm)
      };
      return api;
  };

  const T42JumpListAction = "T42.JumpList.Action";
  class JumpListManager {
      constructor() {
          this._groupActionCallbacks = new Map();
          this._registered = false;
      }
      init(executor, agm, logger) {
          this._executor = executor;
          this._agm = agm;
          this._logger = logger;
          this.registerCallbackMethod();
      }
      setEnabled(windowId, enabled) {
          const settings = {
              enabled
          };
          return this._executor.updateJumpList(windowId, settings);
      }
      createCategory(windowId, title, actions) {
          this.validateActions(title, actions);
          const settings = {
              category: {
                  title,
                  operation: "create",
                  actions: this.toUpdateActions(windowId, "create", title, actions)
              }
          };
          return this._executor.updateJumpList(windowId, settings);
      }
      removeCategory(windowId, title) {
          const settings = {
              category: {
                  title,
                  operation: "remove",
                  actions: []
              }
          };
          this.manageActionCallback(windowId, settings.category.operation, title);
          return this._executor.updateJumpList(windowId, settings);
      }
      createActions(windowId, categoryTitle, actions) {
          this.validateActions(categoryTitle, actions);
          const settings = {
              category: {
                  title: categoryTitle,
                  operation: "update",
                  actions: this.toUpdateActions(windowId, "create", categoryTitle, actions)
              }
          };
          return this._executor.updateJumpList(windowId, settings);
      }
      removeActions(windowId, categoryTitle, actions) {
          const settings = {
              category: {
                  title: categoryTitle,
                  operation: "update",
                  actions: this.toUpdateActions(windowId, "remove", categoryTitle, actions)
              }
          };
          return this._executor.updateJumpList(windowId, settings);
      }
      async getActions(windowId, catgoryTitle) {
          const actions = [];
          const configuration = await this.getJumpListSettings(windowId);
          const currentCategory = configuration.categories.find((category) => category.title === catgoryTitle);
          if (currentCategory) {
              currentCategory.actions.forEach((action) => {
                  const actionCallback = this.getActionCallback(action.callbackId);
                  if (actionCallback) {
                      action.callback = actionCallback.callback;
                  }
                  actions.push({
                      icon: action.icon,
                      callback: action.callback,
                      singleInstanceTitle: action.singleInstanceTitle,
                      multiInstanceTitle: action.multiInstanceTitle
                  });
              });
          }
          return Promise.resolve(actions);
      }
      getJumpListSettings(windowId) {
          return this._executor.getJumpList(windowId);
      }
      toUpdateActions(windowId, operation, categoryTitle, actions) {
          return actions.map((action) => {
              const updateAction = {
                  icon: action.icon,
                  callback: action.callback,
                  callbackId: Utils.generateId(),
                  singleInstanceTitle: action.singleInstanceTitle,
                  multiInstanceTitle: action.multiInstanceTitle,
                  operation
              };
              this.manageActionCallback(windowId, operation, categoryTitle, updateAction);
              return updateAction;
          });
      }
      manageActionCallback(windowId, operation, categoryTitle, updateAction) {
          var _a;
          const groupCallbacksKey = `${categoryTitle}-${windowId}`;
          if (operation === "create") {
              if (!this._groupActionCallbacks.has(groupCallbacksKey)) {
                  this._groupActionCallbacks.set(groupCallbacksKey, []);
              }
              const categoryActionCallbacks = this._groupActionCallbacks.get(groupCallbacksKey);
              categoryActionCallbacks.push({
                  callbackId: updateAction.callbackId,
                  callback: updateAction.callback
              });
          }
          else if (operation === "remove") {
              if (updateAction) {
                  let categoryActionCallbacks = (_a = this._groupActionCallbacks.get(groupCallbacksKey)) !== null && _a !== void 0 ? _a : [];
                  categoryActionCallbacks = categoryActionCallbacks.filter((accCal) => accCal.callbackId !== updateAction.callbackId);
                  if (categoryActionCallbacks.length === 0) {
                      this._groupActionCallbacks.delete(groupCallbacksKey);
                  }
                  else {
                      this._groupActionCallbacks.set(groupCallbacksKey, categoryActionCallbacks);
                  }
              }
              else {
                  this._groupActionCallbacks.delete(groupCallbacksKey);
              }
          }
      }
      registerCallbackMethod() {
          if (this._registered) {
              return;
          }
          this._registered = true;
          try {
              this._agm.register(T42JumpListAction, (args, caller) => {
                  const actionCallback = this.getActionCallback(args.callbackId);
                  if (actionCallback) {
                      try {
                          actionCallback.callback();
                      }
                      catch (e) {
                          this._logger.error("Unable to execute user callback for jump list action!", e);
                      }
                  }
              });
          }
          catch (e) {
              this._logger.error(`Unable to register method ${T42JumpListAction} for invoking jump list action callbacks!`, e);
              return Promise.reject(e);
          }
      }
      getActionCallback(callbackId) {
          let callbackAction;
          [...this._groupActionCallbacks.values()].forEach((callbacks) => {
              const callback = callbacks.find((cal) => cal.callbackId === callbackId);
              if (callback) {
                  callbackAction = callback;
              }
          });
          return callbackAction;
      }
      validateActions(category, actions) {
          if (!(actions && actions.length > 0)) {
              throw new Error(`Category '${category}' doesn't contain any actions!`);
          }
          actions.forEach((action) => {
              if (!action.singleInstanceTitle) {
                  throw new Error(`Category '${category}' contains an action with undefined singleInstanceTitle!`);
              }
              if (!action.multiInstanceTitle) {
                  throw new Error(`Category '${category}' contains an action with undefined multiInstanceTitle!`);
              }
              if (!action.callback) {
                  throw new Error(`Category '${category}' contains an action with undefined callback function!`);
              }
          });
      }
  }
  var jumpListManager = new JumpListManager();

  class WindowStore {
      constructor() {
          this.waitForTimeoutInMilliseconds = 60000;
          this._windows = {};
          this._pendingWindows = {};
          this._pendingWindowsStates = {};
          this._registry = CallbackRegistryFactory();
      }
      init(logger) {
          this._logger = logger;
      }
      get(id) {
          return this._windows[id] || this._pendingWindows[id];
      }
      getIfReady(id) {
          return this._windows[id];
      }
      get list() {
          return this._windows;
      }
      add(window, state) {
          const isExist = typeof this._pendingWindows[window.API.id] !== "undefined";
          if (isExist) {
              this._logger.error(`trying to add window with id ${window.API.id} from windowStore, which already exists`);
              return;
          }
          this._pendingWindows[window.API.id] = window;
          this._pendingWindowsStates[window.API.id] = state;
          this._registry.execute("on-added", window);
          if (this.shouldMarkReadyToShow(state)) {
              this.markReadyToShow(window.API.id);
          }
      }
      remove(window) {
          delete this._windows[window.API.id];
          delete this._pendingWindows[window.API.id];
          delete this._pendingWindowsStates[window.API.id];
          this._registry.execute("on-removed", window);
      }
      setUrlChangedState(windowId) {
          const targetWindowState = this._pendingWindowsStates[windowId];
          if (typeof targetWindowState === "undefined") {
              return;
          }
          targetWindowState.urlChanged = true;
          if (this.shouldMarkReadyToShow(targetWindowState)) {
              this.markReadyToShow(windowId);
          }
      }
      setCompositionChangedState(wrapper) {
          const windowId = wrapper.API.id;
          const targetWindowState = this._pendingWindowsStates[windowId];
          if (typeof targetWindowState === "undefined") {
              return;
          }
          targetWindowState.compositionChanged = true;
          if (this.shouldMarkReadyToShow(targetWindowState)) {
              this.markReadyToShow(windowId);
          }
      }
      waitFor(id) {
          return new Promise((resolve, reject) => {
              let unReady;
              let unRemoved;
              const timeout = setTimeout(() => {
                  unReady();
                  unRemoved();
                  reject(new Error(`Window with id "${id}" was not ready within ${this.waitForTimeoutInMilliseconds} milliseconds.`));
              }, this.waitForTimeoutInMilliseconds);
              const win = this._windows[id];
              if (win) {
                  clearTimeout(timeout);
                  resolve(win);
              }
              else {
                  const cleanup = () => {
                      clearTimeout(timeout);
                      unReady();
                      unRemoved();
                  };
                  unReady = this.onReadyWindow((w) => {
                      if (w.API.id !== id) {
                          return;
                      }
                      cleanup();
                      resolve(w);
                  });
                  unRemoved = this.onRemoved((w) => {
                      if (w.API.id !== id) {
                          return;
                      }
                      cleanup();
                      reject(new Error(`Window with id "${id}" was closed before it became ready.`));
                  });
              }
          });
      }
      onReadyWindow(callback) {
          return this._registry.add("on-ready", callback);
      }
      onAdded(callback) {
          return this._registry.add("on-added", callback);
      }
      onRemoved(callback) {
          return this._registry.add("on-removed", callback);
      }
      markReadyToShow(windowId) {
          if (this._pendingWindows[windowId]) {
              this._windows[windowId] = this._pendingWindows[windowId];
              delete this._pendingWindows[windowId];
              delete this._pendingWindowsStates[windowId];
          }
          this._registry.execute("on-ready", this._windows[windowId]);
      }
      shouldMarkReadyToShow(targetWindowState) {
          return targetWindowState && targetWindowState.urlChanged && targetWindowState.ready && targetWindowState.compositionChanged;
      }
  }
  var windowStore = new WindowStore();

  class JumpListActions {
      constructor(windowId, configuration) {
          this.windowId = windowId;
          this._categoryTitle = configuration.title;
      }
      list() {
          return jumpListManager.getActions(this.windowId, this._categoryTitle);
      }
      create(actions) {
          return jumpListManager.createActions(this.windowId, this._categoryTitle, actions);
      }
      remove(actions) {
          return jumpListManager.removeActions(this.windowId, this._categoryTitle, actions);
      }
  }

  class JumpListCategories {
      constructor(windowId) {
          this.windowId = windowId;
      }
      list() {
          return this.getCategories();
      }
      create(title, actions) {
          return jumpListManager.createCategory(this.windowId, title, actions);
      }
      remove(title) {
          return jumpListManager.removeCategory(this.windowId, title);
      }
      async find(title) {
          const categories = await this.getCategories();
          return categories.find((cat) => cat.title === title);
      }
      async getCategories() {
          const result = [];
          const configuration = await jumpListManager.getJumpListSettings(this.windowId);
          configuration.categories.forEach((category) => {
              result.push({
                  title: category.title,
                  actions: new JumpListActions(this.windowId, category)
              });
          });
          return result;
      }
  }

  class JumpList {
      constructor(windowId) {
          this.windowId = windowId;
          this._categories = new JumpListCategories(windowId);
      }
      get categories() {
          return this._categories;
      }
      async isEnabled() {
          const configuration = await jumpListManager.getJumpListSettings(this.windowId);
          return configuration.enabled;
      }
      setEnabled(enabled) {
          return jumpListManager.setEnabled(this.windowId, enabled);
      }
  }

  var windowFactory = (id, options, executor, logger, appManagerGetter, displayAPIGetter, channelsAPIGetter, agm) => {
      var _a, _b, _c, _d;
      const _registry = CallbackRegistryFactory();
      const getChannels = () => {
          const channels = channelsAPIGetter();
          if (!channels) {
              throw new Error(`To use this method you need to enable channels API - set the channels property to true when initializing the Glue42 library`);
          }
          return channels;
      };
      const _id = id;
      const _name = options.name;
      const _mode = options.mode;
      let _bounds = options.bounds;
      let _url = options.url;
      let _title = options.title;
      let _context = (_a = options.context) !== null && _a !== void 0 ? _a : {};
      let _frameColor = options.frameColor;
      let _focus = options.focus;
      let _neighbours = (_b = options.neighbours) !== null && _b !== void 0 ? _b : {};
      let _groupId = options.groupId;
      let _isGroupHeaderVisible = options.isGroupHeaderVisible;
      let _isTabHeaderVisible = options.isTabHeaderVisible;
      let _isGroupHibernated = options.isGroupHibernated;
      let _isGroupVisible = options.isGroupVisible;
      let _isTabSelected = (_c = options.isTabSelected) !== null && _c !== void 0 ? _c : false;
      let _settings = options.settings;
      const _applicationName = options.applicationName;
      let _isVisible = options.isVisible;
      let _isSticky = options.isSticky;
      let _isCollapsed = options.isCollapsed;
      let _windowState = options.state;
      let _tabGroupId = options.tabGroupId;
      let _tabIndex = options.tabIndex;
      let _frameId = options.frameId;
      let _isLocked = options.isLocked;
      let _allowWorkspaceDrop = options.allowWorkspaceDrop;
      let _isPinned = options.isPinned;
      let _group;
      let _frameButtons = (_d = options.frameButtons) !== null && _d !== void 0 ? _d : [];
      let _zoomFactor = options.zoomFactor;
      let _placementSettings = options.placementSettings;
      const _jumpList = new JumpList(id);
      function close(cbOrOptions, error) {
          if (typeof cbOrOptions === "undefined" || typeof cbOrOptions === "function") {
              return Utils.callbackifyPromise(() => {
                  if (!id) {
                      throw new Error("The window is already closed.");
                  }
                  return executor.close(resultWindow);
              }, cbOrOptions, error);
          }
          else {
              return executor.close(resultWindow, cbOrOptions);
          }
      }
      function navigate(newUrl, optionsOrCallback, error) {
          if (typeof optionsOrCallback === "function") {
              return Utils.callbackifyPromise(() => {
                  if (isNullOrWhiteSpace(newUrl)) {
                      throw new Error("The new URL must be a non-empty string.");
                  }
                  return executor.navigate(resultWindow, newUrl);
              }, optionsOrCallback, error);
          }
          if (isNullOrWhiteSpace(newUrl)) {
              throw new Error("The new URL must be a non-empty string.");
          }
          if ((optionsOrCallback === null || optionsOrCallback === void 0 ? void 0 : optionsOrCallback.timeout) && typeof optionsOrCallback.timeout !== "number") {
              throw new Error("Timeout argument must be a valid number");
          }
          return executor.navigate(resultWindow, newUrl, optionsOrCallback);
      }
      function setStyle(style, success, error) {
          return Utils.callbackifyPromise(() => {
              if (!style || Object.keys(style).length === 0 || Object.keys(style).every((key) => !key)) {
                  throw new Error("Invalid style arguments: " + JSON.stringify(style));
              }
              if (style && style.focus !== undefined) {
                  if (typeof style.focus !== "boolean") {
                      throw new Error("Focus must be a boolean value. Currently, only `focus: true` is supported.");
                  }
                  else if (style.focus === false) {
                      console.warn("`focus: false` is not supported!");
                  }
              }
              if (style && style.hidden !== undefined && typeof style.hidden !== "boolean") {
                  throw new Error("The `hidden` property must hold a boolean value.");
              }
              for (const prop of ["minHeight", "maxHeight", "minWidth", "maxWidth"]) {
                  const styleAsAny = style;
                  const value = styleAsAny[prop];
                  if (prop in style) {
                      if (isUndefinedOrNull(value)) {
                          delete styleAsAny[prop];
                          continue;
                      }
                      if (!isNumber(styleAsAny[prop])) {
                          throw new Error(`"${prop}" must be a number`);
                      }
                  }
              }
              return executor.setStyle(resultWindow, style);
          }, success, error);
      }
      function resetButtons(buttons, success, error) {
          return Utils.callbackifyPromise(() => executor.resetButtons(resultWindow, buttons), success, error);
      }
      function getButtons() {
          return executor.getButtons(resultWindow);
      }
      function setOnTop(onTop, success, error) {
          return Utils.callbackifyPromise(() => {
              if (typeof onTop === "string") {
                  if (onTop !== "always") {
                      throw new Error("`onTop` must hold a `always` value.");
                  }
              }
              else if (typeof onTop !== "boolean") {
                  throw new Error("`onTop` must hold a boolean or `always` value.");
              }
              return executor.setOnTop(resultWindow, onTop);
          }, success, error);
      }
      function setSizeConstraints(constraints, success, error) {
          return Utils.callbackifyPromise(() => {
              if (!constraints || Object.keys(constraints).every((value) => value === undefined)) {
                  throw new Error("The properties of `constraints` cannot be null or undefined.");
              }
              return executor.setSizeConstraints(resultWindow, constraints);
          }, success, error);
      }
      function getSizeConstraints() {
          return executor.getSizeConstraints(resultWindow);
      }
      function setTitle(newTitle, success, error) {
          return Utils.callbackifyPromise(() => {
              if (isUndefinedOrNull(newTitle)) {
                  throw new Error("`newTitle` must not be null or undefined.");
              }
              if (newTitle === _title) {
                  return Promise.resolve(resultWindow);
              }
              return executor.setTitle(resultWindow, newTitle);
          }, success, error);
      }
      function setSticky(isSticky, success, error) {
          return Utils.callbackifyPromise(() => {
              if (typeof isSticky !== "boolean") {
                  throw new Error("`isSticky` must hold a boolean value.");
              }
              return executor.setSticky(resultWindow, isSticky);
          }, success, error);
      }
      function setAllowWorkspaceDrop(allowWorkspaceDrop) {
          if (typeof allowWorkspaceDrop !== "boolean") {
              throw new Error("`allowWorkspaceDrop` must hold a boolean value.");
          }
          return executor.setAllowWorkspaceDrop(resultWindow, allowWorkspaceDrop);
      }
      function pin() {
          return executor.pin(resultWindow);
      }
      function unpin() {
          return executor.unpin(resultWindow);
      }
      function moveResize(bounds, success, error) {
          return Utils.callbackifyPromise(() => {
              if (isUndefinedOrNull(bounds)) {
                  throw new Error("The properties of `bounds` cannot be null or undefined.");
              }
              return executor.moveResize(resultWindow, bounds);
          }, success, error);
      }
      function addFrameButton(buttonInfo, success, error) {
          return Utils.callbackifyPromise(() => {
              if (typeof buttonInfo === "undefined" || Object.keys(buttonInfo).length === 0) {
                  throw new Error("Button info is not available.");
              }
              if (isNullOrWhiteSpace(buttonInfo.buttonId)) {
                  throw new Error("`buttonId` must not be null or undefined.");
              }
              if (isNullOrWhiteSpace(buttonInfo.imageBase64)) {
                  throw new Error("`imageBase64` must not be null or undefined.");
              }
              return executor.addFrameButton(resultWindow, buttonInfo);
          }, success, error);
      }
      function removeFrameButton(buttonId, success, error) {
          return Utils.callbackifyPromise(() => {
              if (isNullOrWhiteSpace(buttonId)) {
                  throw new Error("`buttonId` must not be null or undefined.");
              }
              return executor.removeFrameButton(resultWindow, buttonId);
          }, success, error);
      }
      function activate(success, error) {
          return Utils.callbackifyPromise(() => {
              if (_focus) {
                  return Promise.resolve(resultWindow);
              }
              return executor.activate(resultWindow);
          }, success, error);
      }
      function focus(success, error) {
          return Utils.callbackifyPromise(() => {
              if (_focus) {
                  return Promise.resolve(resultWindow);
              }
              return executor.focus(resultWindow);
          }, success, error);
      }
      function maximizeRestore(success, error) {
          return Utils.callbackifyPromise(() => {
              return executor.maximizeRestore(resultWindow);
          }, success, error);
      }
      function maximize(success, error) {
          return Utils.callbackifyPromise(() => {
              if (_windowState === "maximized") {
                  return Promise.resolve(resultWindow);
              }
              return executor.maximize(resultWindow);
          }, success, error);
      }
      function restore(success, error) {
          return Utils.callbackifyPromise(() => {
              if (_windowState === "normal") {
                  return Promise.resolve(resultWindow);
              }
              return executor.restore(resultWindow);
          }, success, error);
      }
      function minimize(success, error) {
          return Utils.callbackifyPromise(() => {
              if (_windowState === "minimized") {
                  return Promise.resolve(resultWindow);
              }
              return executor.minimize(resultWindow);
          }, success, error);
      }
      function collapse(success, error) {
          return Utils.callbackifyPromise(() => {
              if (_isCollapsed) {
                  return Promise.resolve(resultWindow);
              }
              return executor.collapse(resultWindow);
          }, success, error);
      }
      function expand(success, error) {
          return Utils.callbackifyPromise(() => {
              if (!_isCollapsed) {
                  return Promise.resolve(resultWindow);
              }
              return executor.expand(resultWindow);
          }, success, error);
      }
      function toggleCollapse(success, error) {
          return Utils.callbackifyPromise(() => {
              return executor.toggleCollapse(resultWindow);
          }, success, error);
      }
      function snap(target, direction, success, error) {
          return Utils.callbackifyPromise(() => {
              if (isUndefinedOrNull(target)) {
                  throw new Error(`A target window is not specified - ${typeof target === "string" ? target : JSON.stringify(target)}`);
              }
              if (typeof target === "string") {
                  const win = windowStore.get(target);
                  if (!win) {
                      throw new Error(`Invalid "target" parameter or no such window. Invoked with: ${target}`);
                  }
                  target = win.API;
              }
              if (typeof direction === "string") {
                  direction = {
                      direction,
                      autoAlign: true
                  };
              }
              return executor.snap(resultWindow, target, direction);
          }, success, error);
      }
      function attachTab(tab, opt, success, error) {
          return Utils.callbackifyPromise(() => {
              var _a;
              const errorMessage = `Invalid "tab" parameter - must be an object with an "id" property or a string. Invoked for source window with ID:`;
              if (isUndefinedOrNull(tab)) {
                  const errMsg = `${errorMessage} ${typeof tab === "string" ? tab : JSON.stringify(tab)}`;
                  throw new Error(errMsg);
              }
              let sourceWindow;
              if (typeof tab === "string") {
                  sourceWindow = (_a = windowStore.get(tab)) === null || _a === void 0 ? void 0 : _a.API;
                  if (isUndefinedOrNull(sourceWindow)) {
                      const errMsg = `${errorMessage} ${typeof sourceWindow === "string" ? sourceWindow : JSON.stringify(sourceWindow)}`;
                      throw new Error(errMsg);
                  }
              }
              else if (!isUndefinedOrNull(tab.id)) {
                  sourceWindow = tab;
              }
              else {
                  throw new Error(errorMessage);
              }
              const attachOptions = {};
              if (!isUndefinedOrNull(opt)) {
                  if (typeof opt === "number") {
                      attachOptions.index = opt;
                  }
                  else {
                      attachOptions.selected = opt.selected;
                      attachOptions.index = opt.index;
                  }
              }
              return executor.attachTab(resultWindow, sourceWindow, attachOptions);
          }, success, error);
      }
      function detachTab(opt = {}, success, error) {
          return Utils.callbackifyPromise(() => {
              const argsForSend = {};
              function isDetachRelative(o) {
                  return o.relativeTo !== undefined;
              }
              if (isDetachRelative(opt)) {
                  if (typeof opt.relativeTo === "string") {
                      argsForSend.relativeTo = opt.relativeTo;
                  }
                  else if (!isUndefinedOrNull(opt.relativeTo.id)) {
                      argsForSend.relativeTo = opt.relativeTo.id;
                  }
                  if (!isUndefinedOrNull(opt.relativeDirection)) {
                      argsForSend.relativeDirection = opt.relativeDirection;
                  }
                  if (!isUndefinedOrNull(opt.width)) {
                      argsForSend.width = opt.width;
                  }
                  if (!isUndefinedOrNull(opt.height)) {
                      argsForSend.height = opt.height;
                  }
              }
              else {
                  if (!isUndefinedOrNull(opt.bounds)) {
                      argsForSend.bounds = opt.bounds;
                  }
              }
              if (!isUndefinedOrNull(opt.hideTabHeader)) {
                  argsForSend.hideTabHeader = opt.hideTabHeader;
              }
              return executor.detachTab(resultWindow, argsForSend);
          }, success, error);
      }
      function setVisible(toBeVisible, success, error) {
          return Utils.callbackifyPromise(() => {
              return executor.setVisible(resultWindow, toBeVisible);
          }, success, error);
      }
      async function center(display) {
          if (display) {
              validateCenterArguments(display);
          }
          return executor.center(resultWindow, display);
      }
      function validateCenterArguments(display) {
          if (typeof display !== "object") {
              throw Error("display argument must be a valid display object");
          }
          if (!display.workArea || !display.scaleFactor) {
              throw Error("display argument is not a valid display object");
          }
      }
      function showLoader(loader) {
          return executor.showLoader(resultWindow, loader);
      }
      function hideLoader() {
          return executor.hideLoader(resultWindow);
      }
      function updateContext(context, success, error) {
          return Utils.callbackifyPromise(() => {
              if (!isObject(context)) {
                  throw new Error(`"context" must not be null or undefined.`);
              }
              return executor.updateContext(resultWindow, context, false);
          }, success, error);
      }
      function lock(success, error) {
          return Utils.callbackifyPromise(() => {
              return executor.lock(resultWindow);
          }, success, error);
      }
      function unlock(success, error) {
          return Utils.callbackifyPromise(() => {
              return executor.unlock(resultWindow);
          }, success, error);
      }
      function getIcon(success, error) {
          return Utils.callbackifyPromise(() => {
              return executor.getIcon(resultWindow);
          }, success, error);
      }
      function setIcon(base64Image, success, error) {
          return Utils.callbackifyPromise(() => {
              if (isNullOrWhiteSpace(base64Image)) {
                  throw new Error(`"base64Image" must be a non-empty string.`);
              }
              return executor.setIcon(resultWindow, base64Image);
          }, success, error);
      }
      function setFrameColor(frameColor, success, error) {
          return Utils.callbackifyPromise(() => {
              if (isNullOrWhiteSpace(frameColor)) {
                  throw new Error(`"frameColor" must be a non-empty string`);
              }
              return executor.setFrameColor(resultWindow, frameColor);
          }, success, error);
      }
      function setTabHeaderVisible(toBeTabHeaderVisible, success, error) {
          return Utils.callbackifyPromise(() => {
              if (typeof toBeTabHeaderVisible !== "boolean") {
                  throw new Error(`"toBeTabHeaderVisible" must hold a boolean value.`);
              }
              return executor.setTabHeaderVisible(resultWindow, toBeTabHeaderVisible);
          }, success, error);
      }
      async function setTabTooltip(tooltip) {
          if (isNullOrWhiteSpace(tooltip)) {
              throw new Error(`"${tooltip}" must not be null or undefined`);
          }
          return executor.setTabTooltip(resultWindow, tooltip);
      }
      async function getTabTooltip() {
          return executor.getTabTooltip(resultWindow);
      }
      function showPopup(config) {
          return executor.showPopup(resultWindow, config);
      }
      function createFlydown(config) {
          return executor.createFlydown(resultWindow.id, config);
      }
      function setModalState(isModal) {
          return executor.setModalState(resultWindow.id, isModal || false);
      }
      function zoomIn(success, error) {
          return Utils.callbackifyPromise(() => {
              return executor.zoomIn(resultWindow);
          }, success, error);
      }
      function zoomOut(success, error) {
          return Utils.callbackifyPromise(() => {
              return executor.zoomOut(resultWindow);
          }, success, error);
      }
      function setZoomFactor(zoomFactor, success, error) {
          return Utils.callbackifyPromise(() => {
              if (isNaN(zoomFactor)) {
                  throw new Error(`zoomFactor is not a number`);
              }
              return executor.setZoomFactor(resultWindow, zoomFactor);
          }, success, error);
      }
      function showDevTools() {
          return executor.showDevTools(resultWindow);
      }
      function capture(captureOptions) {
          return executor.capture(resultWindow, captureOptions);
      }
      function flash(suppliedOptions, mode) {
          const flashOptions = {
              shouldFlash: true,
              mode: "auto"
          };
          if (typeof suppliedOptions === "boolean") {
              flashOptions.shouldFlash = suppliedOptions;
          }
          if (typeof mode !== "undefined") {
              flashOptions.mode = mode;
          }
          return executor.flash(resultWindow, flashOptions);
      }
      function flashTab(suppliedOptions) {
          const flashOptions = {
              shouldFlash: true,
          };
          if (typeof suppliedOptions === "boolean") {
              flashOptions.shouldFlash = suppliedOptions;
          }
          return executor.flashTab(resultWindow, flashOptions);
      }
      function print(printOptions) {
          return executor.print(resultWindow, printOptions);
      }
      function printToPDF(printToPDFOptions) {
          return executor.printToPDF(resultWindow, printToPDFOptions);
      }
      function ungroup(ungroupOptions) {
          return new Promise((resolve, reject) => {
              const unGroupChanged = onGroupChanged((win, newGroup, oldGroup) => {
                  if (id === win.id) {
                      unGroupChanged();
                      resolve(resultWindow);
                  }
              });
              executor.ungroup(resultWindow, ungroupOptions)
                  .catch((e) => {
                  unGroupChanged();
                  reject(e);
              });
          });
      }
      function place(placementSettings) {
          return executor.place(resultWindow, placementSettings);
      }
      function refresh(ignoreCache) {
          return executor.refresh(resultWindow, ignoreCache);
      }
      function download(url, opts) {
          return executor.download(resultWindow, url, opts);
      }
      function configure(settings) {
          return executor.configureWindow(resultWindow, settings);
      }
      function getConfiguration() {
          return executor.getWindowConfiguration(resultWindow);
      }
      function getDockingPlacement() {
          return executor.getDockingPlacement(resultWindow);
      }
      function dock(opts) {
          return executor.dock(resultWindow, opts);
      }
      async function clone(cloneOptions) {
          return executor.clone(resultWindow, cloneOptions);
      }
      async function executeCode(code) {
          if (!code) {
              throw new Error("Code argument is missing");
          }
          if (typeof code !== "string") {
              throw new Error("Code argument must be a valid string");
          }
          const response = await executor.executeCode(resultWindow, code);
          return response.result;
      }
      function onTitleChanged(callback) {
          if (!isFunction(callback)) {
              throw new Error("callback should be a function");
          }
          callback(resultWindow.title, resultWindow);
          return onEventCore("onTitleChanged", callback);
      }
      function onClose(callback) {
          if (!isFunction(callback)) {
              throw new Error("callback should be a function");
          }
          if (id === undefined) {
              callback(resultWindow);
          }
          return _registry.add("onClose", callback);
      }
      function onUrlChanged(callback) {
          return onEventCore("onUrlChanged", callback);
      }
      function onFrameButtonAdded(callback) {
          return onEventCore("onFrameButtonAdded", callback);
      }
      function onFrameButtonRemoved(callback) {
          return onEventCore("onFrameButtonRemoved", callback);
      }
      function onFrameButtonClicked(callback) {
          return onEventCore("onFrameButtonClicked", callback);
      }
      function onCollapsed(callback) {
          if (!isFunction(callback)) {
              throw new Error("callback should be a function");
          }
          if (_isCollapsed) {
              callback(resultWindow);
          }
          return _registry.add("collapsed", callback);
      }
      function onExpanded(callback) {
          if (!isFunction(callback)) {
              throw new Error("callback should be a function");
          }
          if (!_isCollapsed) {
              callback(resultWindow);
          }
          return _registry.add("expanded", callback);
      }
      function onMaximized(callback) {
          if (_windowState === "maximized") {
              return onEventCore("maximized", callback, [resultWindow]);
          }
          else {
              return onEventCore("maximized", callback);
          }
      }
      function onMinimized(callback) {
          if (_windowState === "minimized") {
              return onEventCore("minimized", callback, [resultWindow]);
          }
          else {
              return onEventCore("minimized", callback);
          }
      }
      function onNormal(callback) {
          if (_windowState === "normal") {
              return onEventCore("normal", callback, [resultWindow]);
          }
          else {
              return onEventCore("normal", callback);
          }
      }
      function onAttached(callback) {
          return onEventCore("attached", callback);
      }
      function onDetached(callback) {
          return onEventCore("detached", callback);
      }
      function onVisibilityChanged(callback) {
          return onEventCore("visibility-changed", callback);
      }
      function onContextUpdated(callback) {
          return onEventCore("context-updated", callback);
      }
      function onLockingChanged(callback) {
          return onEventCore("lock-changed", callback);
      }
      function onBoundsChanged(callback) {
          return onEventCore("bounds-changed", callback);
      }
      function onFocusChanged(callback) {
          return onEventCore("focus-changed", callback);
      }
      function onStickyChanged(callback) {
          return onEventCore("sticky-changed", callback);
      }
      function onFrameColorChanged(callback) {
          return onEventCore("frame-color-changed", callback);
      }
      function onTabHeaderVisibilityChanged(callback) {
          return onEventCore("tab-header-visibility-changed", callback);
      }
      function onWindowAttached(callback) {
          return onEventCore("window-attached", callback);
      }
      function onWindowDetached(callback) {
          return onEventCore("window-detached", callback);
      }
      function onGroupChanged(callback) {
          return onEventCore("group-changed", callback);
      }
      function onTabSelectionChanged(callback) {
          return onEventCore("tab-selection-changed", callback);
      }
      function onChannelRestrictionsChanged(callback) {
          if (!isFunction(callback)) {
              throw new Error("callback must be a function");
          }
          return onEventCore("channel-restrictions-changed", callback);
      }
      function onClosing(callback) {
          if (!isFunction(callback)) {
              throw new Error("callback must be a function");
          }
          const callbackWrap = (success, error, prevent) => {
              const promise = callback(prevent);
              if (promise === null || promise === void 0 ? void 0 : promise.then) {
                  promise.then(success).catch(error);
              }
              else {
                  success();
              }
          };
          return executor.onClosing(callbackWrap, resultWindow);
      }
      function onRefreshing(callback) {
          if (!isFunction(callback)) {
              throw new Error("callback must be a function");
          }
          const callbackWrap = (success, error, prevent) => {
              const promise = callback(prevent);
              if (promise === null || promise === void 0 ? void 0 : promise.then) {
                  promise.then(success).catch(error);
              }
              else {
                  success();
              }
          };
          return executor.onRefreshing(callbackWrap, resultWindow);
      }
      function onNavigating(callback) {
          if (!isFunction(callback)) {
              throw new Error("callback must be a function");
          }
          const callbackWrap = (success, error, prevent, args) => {
              const promise = callback(args);
              if (promise === null || promise === void 0 ? void 0 : promise.then) {
                  promise.then(success).catch(error);
              }
              else {
                  success();
              }
          };
          return executor.onNavigating(callbackWrap, resultWindow);
      }
      function onZoomFactorChanged(callback) {
          return onEventCore("zoom-factor-changed", callback);
      }
      function onPlacementSettingsChanged(callback) {
          return onEventCore("placementSettingsChanged", callback);
      }
      function onNeighboursChanged(callback) {
          return onEventCore("neighbours-changed", callback);
      }
      function onDockingChanged(callback) {
          return onEventCore("docking-changed", callback);
      }
      function onEventCore(key, callback, replayArguments) {
          if (!isFunction(callback)) {
              throw new Error("callback must be a function");
          }
          return _registry.add(key, callback, replayArguments);
      }
      function goBack() {
          return executor.goBack(resultWindow);
      }
      function goForward() {
          return executor.goForward(resultWindow);
      }
      function startDrag(option) {
          return executor.startDrag(resultWindow, option);
      }
      function showDialog(dialogOptions) {
          if ((dialogOptions === null || dialogOptions === void 0 ? void 0 : dialogOptions.timerDuration) && isNaN(dialogOptions === null || dialogOptions === void 0 ? void 0 : dialogOptions.timerDuration)) {
              throw new Error("timerDuration must be a number");
          }
          if ((dialogOptions === null || dialogOptions === void 0 ? void 0 : dialogOptions.showTimer) && typeof (dialogOptions === null || dialogOptions === void 0 ? void 0 : dialogOptions.showTimer) !== "boolean") {
              throw new Error("showTimer must be a boolean");
          }
          return executor.showDialog(resultWindow, dialogOptions);
      }
      function handleUpdate(updated) {
          _url = updated.url;
          _title = updated.title;
          _context = updated.context || {};
          _bounds = updated.bounds;
          _frameColor = updated.frameColor;
          _focus = updated.focus;
          _neighbours = updated.neighbours || {};
          _groupId = updated.groupId;
          _isGroupHeaderVisible = updated.isGroupHeaderVisible;
          _isTabHeaderVisible = updated.isTabHeaderVisible;
          _isGroupHibernated = updated.isGroupHibernated;
          _isGroupVisible = updated.isGroupVisible;
          _isTabSelected = updated.isTabSelected;
          _settings = updated.settings;
          _isVisible = updated.isVisible;
          _isSticky = updated.isSticky;
          _isCollapsed = updated.isCollapsed;
          _windowState = updated.state;
          _tabGroupId = updated.tabGroupId;
          _frameId = updated.frameId;
          _isLocked = updated.isLocked;
          _allowWorkspaceDrop = updated.allowWorkspaceDrop;
          _isPinned = updated.isPinned;
          _zoomFactor = updated.zoomFactor;
          _placementSettings = updated.placementSettings;
      }
      function handleTitleChanged(newTitle) {
          _title = newTitle;
          executor.finished
              .finally(() => {
              _registry.execute("onTitleChanged", newTitle, resultWindow);
          });
      }
      function handleUrlChanged(newUrl) {
          _url = newUrl;
          _registry.execute("onUrlChanged", newUrl, resultWindow);
      }
      function handleVisibilityChanged(isVisible) {
          if (isVisible === _isVisible) {
              return;
          }
          _isVisible = isVisible;
          _registry.execute("visibility-changed", resultWindow);
      }
      function handleWindowSettingsChanged(settings) {
          _settings = settings;
          _registry.execute("settings-changed", resultWindow);
      }
      function handleContextUpdated(context) {
          _context = context;
          _registry.execute("context-updated", _context, resultWindow);
      }
      function handleWindowClose() {
          if (id === undefined) {
              return;
          }
          _registry.execute("onClose", resultWindow);
          id = undefined;
      }
      function handleFrameButtonAdded(frameButton) {
          const buttonObj = ["buttonId", "imageBase64", "order", "tooltip"].reduce((memo, k) => {
              memo[k] = frameButton[k];
              return memo;
          }, {});
          const frameButtonsIds = _frameButtons.map((btn) => {
              return btn.buttonId;
          });
          if (frameButtonsIds.indexOf(frameButton.buttonId) === -1) {
              _frameButtons.push(buttonObj);
          }
          _registry.execute("onFrameButtonAdded", buttonObj, resultWindow);
      }
      function handleFrameButtonRemoved(frameButtonId) {
          let button;
          _frameButtons = _frameButtons.reduce((memo, btn) => {
              if (btn.buttonId === frameButtonId) {
                  button = btn;
              }
              else {
                  memo.push(btn);
              }
              return memo;
          }, []);
          if (button !== undefined) {
              _registry.execute("onFrameButtonRemoved", button, resultWindow);
          }
      }
      function handleFrameButtonClicked(frameButton) {
          const button = _frameButtons.filter((btn) => {
              return btn.buttonId === frameButton.buttonId;
          });
          if (button.length > 0) {
              _registry.execute("onFrameButtonClicked", button[0], resultWindow);
          }
      }
      async function handleWindowChangeState(state) {
          if (state === "collapsed") {
              _isCollapsed = true;
          }
          else if (state === "expanded") {
              _isCollapsed = false;
          }
          else {
              _windowState = state;
          }
          await executor.finished;
          _registry.execute(state, resultWindow);
      }
      function handleFrameIsLockedChanged(isLocked) {
          _isLocked = isLocked;
          _registry.execute("lock-changed", resultWindow);
      }
      function handleBoundsChanged(bounds) {
          if (_bounds.top === bounds.top && _bounds.left === bounds.left && _bounds.width === bounds.width && _bounds.height === bounds.height) {
              return;
          }
          _bounds = bounds;
          _registry.execute("bounds-changed", resultWindow);
      }
      function handleFocusChanged(isFocused) {
          _focus = isFocused;
          _registry.execute("focus-changed", resultWindow);
      }
      function handleIsStickyChanged(isSticky) {
          _isSticky = isSticky;
          _registry.execute("sticky-changed", isSticky, resultWindow);
      }
      function handleFrameColorChanged(frameColor) {
          _frameColor = frameColor;
          _registry.execute("frame-color-changed", resultWindow);
      }
      function handleFrameAttached(tabGroupId, frameId, isTabHeaderVisible) {
          _tabGroupId = tabGroupId;
          _frameId = frameId;
          _isTabHeaderVisible = isTabHeaderVisible;
          _registry.execute("frame-attached", resultWindow);
      }
      function handleCompositionChanged(state) {
          _neighbours = state.neighbors || {};
          _tabIndex = state.index;
          _registry.execute("neighbours-changed", _neighbours, resultWindow);
      }
      function handleAllowWorkspaceDropChanged(allowWorkspaceDrop) {
          _allowWorkspaceDrop = allowWorkspaceDrop;
          _registry.execute("allow-workspace-drop-changed", resultWindow);
      }
      function handleIsPinnedChanged(isPinned) {
          _isPinned = isPinned;
          _registry.execute("is-pinned-changed", resultWindow);
      }
      function handleGroupHeaderVisibilityChanged(isGroupHeaderVisible) {
          _isGroupHeaderVisible = isGroupHeaderVisible;
      }
      function handleTabHeaderVisibilityChanged(isTabHeaderVisible) {
          if (_isTabHeaderVisible !== isTabHeaderVisible) {
              _isTabHeaderVisible = isTabHeaderVisible;
              _registry.execute("tab-header-visibility-changed", resultWindow);
          }
      }
      async function handleFrameSelectionChanged(newWindow, prevWindow) {
          let selectedWindow;
          if (newWindow === id) {
              _isTabSelected = true;
              selectedWindow = resultWindow;
          }
          else {
              _isTabSelected = false;
              selectedWindow = windowStore.get(newWindow) ? windowStore.get(newWindow).API : undefined;
          }
          const previousWindow = windowStore.get(prevWindow) ? windowStore.get(prevWindow).API : undefined;
          await executor.finished;
          _registry.execute("tab-selection-changed", selectedWindow, previousWindow, resultWindow);
      }
      async function handleAttached(newTabGroupId, newFrameId, tabHeaderVisible, isLocked, winsToBeNotified) {
          _tabGroupId = newTabGroupId;
          _isTabHeaderVisible = tabHeaderVisible;
          _frameId = newFrameId;
          if (typeof isLocked !== "undefined") {
              _isLocked = isLocked;
          }
          await executor.finished;
          winsToBeNotified.forEach((w) => {
              w.Events.handleWindowAttached(resultWindow);
          });
          _registry.execute("attached", resultWindow);
      }
      function handleWindowAttached(win) {
          _registry.execute("window-attached", win);
      }
      async function handleDetached(isLocked, winsToBeNotified) {
          _tabGroupId = undefined;
          _isTabSelected = false;
          if (typeof isLocked !== "undefined") {
              _isLocked = isLocked;
          }
          await executor.finished;
          winsToBeNotified.forEach((w) => {
              w.Events.handleWindowDetached(resultWindow);
          });
          _registry.execute("detached", resultWindow);
      }
      function handleWindowDetached(win) {
          _registry.execute("window-detached", win);
      }
      function handleZoomFactorChanged(zoomFactor) {
          _zoomFactor = zoomFactor;
          _registry.execute("zoom-factor-changed", resultWindow);
      }
      function handlePlacementSettingsChanged(placementSettings) {
          let promise;
          const copy = placementSettings;
          if (!copy.display) {
              promise = Promise.resolve(undefined);
          }
          else {
              const displayAPI = displayAPIGetter();
              if (!displayAPI) {
                  promise = Promise.resolve(undefined);
              }
              else {
                  const index = copy.display - 1;
                  promise = new Promise((resolve, reject) => {
                      displayAPI.all().then((displays) => {
                          const display = displays.find((d) => d.index === index);
                          resolve(display);
                      }).catch(reject);
                  });
              }
          }
          void promise.then((d) => {
              copy.display = d;
              _placementSettings = copy;
              _registry.execute("placementSettingsChanged", resultWindow);
          });
      }
      function handleDockingChanged(data) {
          _registry.execute("docking-changed", resultWindow, {
              docked: data.docked,
              position: data.position,
              claimScreenArea: data.claimScreenArea
          });
      }
      function handleChannelRestrictionsChanged(data) {
          _registry.execute("channel-restrictions-changed", data);
      }
      function handleGroupChanged(newGroup, oldGroup) {
          _group = newGroup;
          _groupId = newGroup === null || newGroup === void 0 ? void 0 : newGroup.id;
          if (!isUndefinedOrNull(newGroup) && !isUndefinedOrNull(oldGroup)) {
              _registry.execute("group-changed", resultWindow, newGroup, oldGroup);
          }
      }
      function getAllTabs() {
          const allWindows = windowStore.list;
          if (_mode.toLowerCase() !== "tab") {
              return [];
          }
          const tabs = Object.keys(allWindows).reduce((memo, win) => {
              const window = allWindows[win];
              if (window
                  && window.API.tabGroupId
                  && typeof window.API.tabGroupId !== "undefined"
                  && typeof resultWindow.tabGroupId !== "undefined"
                  && window.API.tabGroupId === resultWindow.tabGroupId) {
                  memo.push(window.API);
              }
              return memo;
          }, []);
          return tabs.sort((w1, w2) => {
              if (w1.tabIndex !== w2.tabIndex) {
                  if (w1.tabIndex === -1) {
                      return Number.MAX_SAFE_INTEGER;
                  }
                  if (w2.tabIndex === -1) {
                      return Number.MIN_SAFE_INTEGER;
                  }
              }
              return w1.tabIndex - w2.tabIndex;
          });
      }
      function mapWindowIdsToWindowObjects(windowIdArr) {
          return windowIdArr.reduce((memo, winId) => {
              const window = windowStore.get(winId);
              if (window) {
                  memo.push(window.API);
              }
              return memo;
          }, []);
      }
      function getNeighboursByDirection(direction) {
          const windowIds = _neighbours[direction];
          if (typeof windowIds !== "undefined") {
              return mapWindowIdsToWindowObjects(windowIds);
          }
      }
      function getApplicationName() {
          var _a;
          if (_applicationName) {
              return _applicationName;
          }
          if (_context._APPLICATION_NAME) {
              return _context._APPLICATION_NAME;
          }
          if (_context && _context._t42 && _context._t42.application) {
              return _context._t42.application;
          }
          const info = getWindowInfo();
          if (info && info.applicationName) {
              return info.applicationName;
          }
          const appManager = appManagerGetter();
          if (appManager) {
              const instance = appManager.instances().find((i) => id === i.id);
              if (instance) {
                  return (_a = instance.application) === null || _a === void 0 ? void 0 : _a.name;
              }
          }
          return undefined;
      }
      function getWindowInfo() {
          if (typeof window !== "undefined" && window.glue42gd && window.glue42gd.getWindowInfo) {
              const info = window.glue42gd.getWindowInfo(id);
              if (!info) {
                  return undefined;
              }
              else {
                  return info;
              }
          }
      }
      const resultWindow = {
          get id() {
              return _id;
          },
          get name() {
              return _name;
          },
          get application() {
              const appManager = appManagerGetter();
              const appName = getApplicationName();
              if (appName && appManager) {
                  return appManager.application(appName);
              }
          },
          get hostInstance() {
              return executor.hostInstance;
          },
          get interopInstance() {
              const instance = agm.servers().find((s) => s.windowId === this.id);
              if (instance) {
                  return instance;
              }
              else {
                  const appName = getApplicationName();
                  if (appName) {
                      return { application: appName };
                  }
              }
          },
          get agmInstance() {
              return resultWindow.interopInstance;
          },
          get url() {
              return _url;
          },
          get title() {
              return _title;
          },
          get windowStyleAttributes() {
              return _settings;
          },
          get settings() {
              return _settings;
          },
          get tabGroupId() {
              return _mode.toLowerCase() === "tab" ? _tabGroupId : undefined;
          },
          get tabIndex() {
              return _mode.toLowerCase() === "tab" ? _tabIndex : undefined;
          },
          get frameId() {
              return _frameId;
          },
          get frameButtons() {
              return _frameButtons.sort((b1, b2) => b1.order - b2.order);
          },
          get mode() {
              return _mode;
          },
          get state() {
              return _windowState;
          },
          get isCollapsed() {
              return _isCollapsed;
          },
          get isVisible() {
              return _isVisible;
          },
          get isLocked() {
              return _isLocked;
          },
          get context() {
              return _context;
          },
          get bounds() {
              return _bounds;
          },
          get minHeight() {
              return _settings.minHeight;
          },
          get maxHeight() {
              return _settings.maxHeight;
          },
          get minWidth() {
              return _settings.minWidth;
          },
          get maxWidth() {
              return _settings.maxWidth;
          },
          get isFocused() {
              return _focus;
          },
          get frameColor() {
              return _frameColor;
          },
          get opened() {
              return resultWindow.id !== undefined;
          },
          get group() {
              return _group;
          },
          get groupId() {
              return _groupId;
          },
          get isSticky() {
              return _isSticky;
          },
          get topNeighbours() {
              return getNeighboursByDirection("top");
          },
          get leftNeighbours() {
              return getNeighboursByDirection("left");
          },
          get rightNeighbours() {
              return getNeighboursByDirection("right");
          },
          get bottomNeighbours() {
              return getNeighboursByDirection("bottom");
          },
          get isGroupHeaderVisible() {
              return _isGroupHeaderVisible;
          },
          get activityId() {
              if (_context._t42) {
                  return _context._t42.activityId;
              }
              const info = getWindowInfo();
              if (!info) {
                  return undefined;
              }
              return info.activityId;
          },
          get activityWindowId() {
              if (_context._t42) {
                  return _context._t42.activityWindowId;
              }
              const info = getWindowInfo();
              if (!info) {
                  return undefined;
              }
              return info.activityWindowId;
          },
          get windowType() {
              return options.windowType || "electron";
          },
          get zoomFactor() {
              return _zoomFactor;
          },
          get screen() {
              if (typeof window !== "undefined" && window.glue42gd) {
                  return Utils.getMonitor(resultWindow.bounds, window.glue42gd.monitors);
              }
              return undefined;
          },
          get placementSettings() {
              return Object.assign({}, _placementSettings);
          },
          get jumpList() {
              return _jumpList;
          },
          get allowWorkspaceDrop() {
              return _allowWorkspaceDrop;
          },
          get isPinned() {
              return _isPinned;
          },
          maximize,
          restore,
          minimize,
          maximizeRestore,
          collapse,
          expand,
          toggleCollapse,
          focus,
          activate,
          moveResize,
          setTitle,
          setStyle,
          setOnTop,
          resetButtons,
          getButtons,
          setSizeConstraints,
          getSizeConstraints,
          navigate,
          addFrameButton,
          removeFrameButton,
          setVisible,
          show: () => setVisible(true),
          hide: () => setVisible(false),
          center,
          close,
          snap,
          showLoader,
          hideLoader,
          updateContext,
          lock,
          unlock,
          getIcon,
          setIcon,
          setFrameColor,
          setTabTooltip,
          getTabTooltip,
          attachTab,
          detachTab,
          setTabHeaderVisible,
          showPopup,
          createFlydown,
          setModalState,
          setZoomFactor,
          zoomIn,
          zoomOut,
          showDevTools,
          capture,
          flash,
          flashTab,
          setSticky,
          setAllowWorkspaceDrop,
          pin,
          unpin,
          print,
          printToPDF,
          place,
          ungroup,
          refresh,
          goBack,
          goForward,
          download,
          configure,
          getConfiguration,
          getDockingPlacement,
          dock,
          clone,
          executeCode,
          getChannel: async () => {
              var _a;
              const wins = await getChannels().getWindowsWithChannels({ windowIds: [_id] });
              return (_a = wins[0]) === null || _a === void 0 ? void 0 : _a.channel;
          },
          startDrag,
          showDialog,
          onClose,
          onUrlChanged,
          onTitleChanged,
          onFrameButtonAdded,
          onFrameButtonRemoved,
          onFrameButtonClicked,
          onCollapsed,
          onExpanded,
          onMinimized,
          onMaximized,
          onNormal,
          onAttached,
          onDetached,
          onVisibilityChanged,
          onContextUpdated,
          onLockingChanged,
          onBoundsChanged,
          onFrameColorChanged,
          onFocusChanged,
          onStickyChanged,
          onGroupChanged,
          onWindowAttached,
          onWindowDetached,
          onTabSelectionChanged,
          onTabHeaderVisibilityChanged,
          onClosing,
          onRefreshing,
          onZoomFactorChanged,
          onPlacementSettingsChanged,
          onNeighboursChanged,
          onDockingChanged,
          onNavigating,
          onChannelRestrictionsChanged,
          get tabs() {
              return getAllTabs();
          },
          get isTabHeaderVisible() {
              return _isTabHeaderVisible;
          },
          get isTabSelected() {
              return _isTabSelected;
          },
          getURL() {
              return Promise.resolve(_url);
          },
          getTitle() {
              return Promise.resolve(_title);
          },
          getBounds() {
              return Promise.resolve(_bounds);
          },
          getContext() {
              return Promise.resolve(_context);
          },
          setContext(context) {
              if (!isObject(context)) {
                  throw new Error(`"context" must not be null or undefined, set to empty object if you want to clear it out.`);
              }
              return executor.updateContext(resultWindow, context, true);
          },
          getDisplay() {
              const displayAPI = displayAPIGetter();
              return displayAPI.getByWindowId(id);
          },
          resizeTo(width, height) {
              return moveResize({ width, height });
          },
          moveTo(top, left) {
              return moveResize({ top, left });
          },
          async getParentWindow() {
              var _a;
              const myParentId = _settings.parentInstanceId;
              if (!myParentId) {
                  return undefined;
              }
              return (_a = windowStore.list[myParentId]) === null || _a === void 0 ? void 0 : _a.API;
          },
          async getChildWindows() {
              return Object.keys(windowStore.list)
                  .map((key) => windowStore.list[key].API)
                  .filter((w) => {
                  const parentId = w.settings.parentInstanceId;
                  return parentId === id;
              });
          },
          joinChannel: (name) => {
              return getChannels().join(name, id);
          },
          leaveChannel: () => {
              return getChannels().leave(id);
          }
      };
      const events = {
          handleUpdate,
          handleWindowClose,
          handleWindowChangeState,
          handleTitleChanged,
          handleVisibilityChanged,
          handleUrlChanged,
          handleWindowSettingsChanged,
          handleContextUpdated,
          handleFrameIsLockedChanged,
          handleBoundsChanged,
          handleFocusChanged,
          handleFrameButtonAdded,
          handleFrameButtonRemoved,
          handleFrameButtonClicked,
          handleFrameColorChanged,
          handleFrameAttached,
          handleFrameSelectionChanged,
          handleCompositionChanged,
          handleAllowWorkspaceDropChanged,
          handleIsPinnedChanged,
          handleGroupHeaderVisibilityChanged,
          handleTabHeaderVisibilityChanged,
          handleGroupChanged,
          handleAttached,
          handleDetached,
          handleWindowAttached,
          handleWindowDetached,
          handleZoomFactorChanged,
          handleIsStickyChanged,
          handlePlacementSettingsChanged,
          handleDockingChanged,
          handleChannelRestrictionsChanged
      };
      const groupArgs = {
          get isGroupHibernated() {
              return _isGroupHibernated;
          },
          get isGroupVisible() {
              return _isGroupVisible;
          },
      };
      return {
          API: resultWindow,
          Events: events,
          GroupCreationArgs: groupArgs
      };
  };

  function getWindowsByTabGroupId(windowId, tabGroupId) {
      const windows = windowStore.list;
      return Object.keys(windows).reduce((memo, id) => {
          const win = windows[id];
          if (win.API.tabGroupId === tabGroupId && win.API.id !== windowId) {
              memo.push(win);
          }
          return memo;
      }, []);
  }
  function isEmpty(object) {
      if (!object || Object.keys(object).every((value) => object[value] === undefined)) {
          return true;
      }
      return false;
  }

  class GDExecutor {
      constructor() {
          this.GroupMethodName = "T42.Group.Execute";
          this.WndMethodName = "T42.Wnd.Execute";
          this._registry = CallbackRegistryFactory();
          this._finished = Promise.resolve();
          this._configuration = {
              windowAvailableOnURLChanged: true
          };
          this.unsubCallbacks = {};
      }
      get hostInstance() {
          return this.agmTarget;
      }
      get finished() {
          return this._finished;
      }
      get configuration() {
          return this._configuration;
      }
      init(agm, instance) {
          this.agm = agm;
          this.agmTarget = instance;
          this._registry.add("event", (data) => {
              if (data.type === "Closed") {
                  const keys = Object.keys(this.unsubCallbacks);
                  keys.forEach((key) => {
                      const isSameWindow = key.startsWith(data.windowId);
                      if (isSameWindow) {
                          delete this.unsubCallbacks[key];
                      }
                  });
              }
          });
      }
      setConfiguration(config) {
          this._configuration = { ...this._configuration, ...config };
      }
      handleEvent(data) {
          this._registry.execute("event", data);
      }
      async open(options) {
          let finishedResolve;
          this._finished = new Promise((resolve) => {
              finishedResolve = resolve;
          });
          try {
              const result = await this.agm.invoke("T42.Wnd.Create", options, this.agmTarget, {
                  waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
                  methodResponseTimeoutMs: INTEROP_METHOD_RESPONSE_TIMEOUT_MS
              });
              if (result.returned === undefined) {
                  throw new Error("failed to execute T42.Wnd.Create - unknown reason");
              }
              const id = result.returned.id;
              const win = await windowStore.waitFor(id);
              if (!this.configuration || this.configuration.windowAvailableOnURLChanged) {
                  setTimeout(() => {
                      if (win.API.windowType === "electron") {
                          win.Events.handleUrlChanged(win.API.url);
                      }
                  }, 0);
              }
              return win.API;
          }
          finally {
              finishedResolve();
          }
      }
      async close(w, options) {
          const result = await this.execute("close", { windowId: w.id, options }, `Closed`);
          if (options) {
              return result.closed;
          }
          return w;
      }
      async navigate(w, newUrl, urlLoadOptions) {
          let methodResponseTimeoutMs = 120000;
          if (typeof urlLoadOptions === "object" && typeof urlLoadOptions.timeout === "number") {
              methodResponseTimeoutMs = urlLoadOptions.timeout * 1000;
              delete urlLoadOptions.timeout;
          }
          await this.execute("navigate", { windowId: w.id, options: { url: newUrl, urlLoadOptions }, invocationOptions: { methodResponseTimeoutMs } }, "UrlChanged");
          return w;
      }
      async setStyle(w, style) {
          var _a;
          const stylePromises = [];
          const wait = (promise) => stylePromises.push(promise);
          if (!isUndefinedOrNull(style.focus) && !w.isFocused) {
              wait(w.focus());
          }
          if (!isUndefinedOrNull(style.hidden)) {
              const toBeVisible = !style.hidden;
              wait(w.setVisible(toBeVisible));
          }
          if (!isUndefinedOrNull(style.onTop)) {
              wait(w.setOnTop(style.onTop));
          }
          if (!isNullOrWhiteSpace(style.tabTooltip) || !isNullOrWhiteSpace(style.tabToolTip)) {
              const toolTip = (_a = style.tabTooltip) !== null && _a !== void 0 ? _a : style.tabToolTip;
              wait(w.setTabTooltip(toolTip));
          }
          if (!isNullOrWhiteSpace(style.tabTitle)) {
              wait(this.execute("setTabTitle", { windowId: w.id, options: { tabTitle: style.tabTitle } }));
          }
          const constraints = {
              minHeight: style.minHeight,
              minWidth: style.minWidth,
              maxHeight: style.maxHeight,
              maxWidth: style.maxWidth,
          };
          const hasConstraints = !isEmpty(constraints);
          if (hasConstraints) {
              wait(w.setSizeConstraints(constraints));
          }
          const buttons = {
              allowClose: style.allowClose,
              allowCollapse: style.allowCollapse,
              allowLockUnlock: style.allowLockUnlock,
              allowMaximize: style.allowMaximize,
              allowMinimize: style.allowMinimize
          };
          const hasButtons = !isEmpty(buttons);
          if (hasButtons) {
              wait(w.resetButtons(buttons));
          }
          await Promise.all(stylePromises);
          return w;
      }
      async setSizeConstraints(w, constraints) {
          await this.execute("setSizeConstraints", { windowId: w.id, options: constraints });
          return w;
      }
      async getSizeConstraints(w) {
          const sizeConstraint = await this.execute("getSizeConstraints", { windowId: w.id });
          return sizeConstraint;
      }
      async setTabTooltip(w, tabTooltip) {
          await this.execute("setTabTooltip", { windowId: w.id, options: { tabTooltip } });
          return w;
      }
      async getTabTooltip(w) {
          const result = await this.execute("getTabTooltip", { windowId: w.id });
          return result.tabTooltip;
      }
      async resetButtons(w, buttonsConfig) {
          await this.execute("resetButtons", { windowId: w.id, options: buttonsConfig });
          return w;
      }
      async getButtons(w) {
          const buttons = await this.execute("getButtons", { windowId: w.id });
          return buttons;
      }
      async setOnTop(w, onTop) {
          await this.execute("setOnTop", { windowId: w.id, options: { onTop } });
          return w;
      }
      async setTitle(w, newTitle) {
          const options = {
              windowId: w.id,
              options: {
                  title: newTitle
              }
          };
          await this.execute("setTitle", options, "TitleChanged");
          return w;
      }
      async setSticky(w, isSticky) {
          const options = {
              windowId: w.id,
              options: {
                  isSticky
              }
          };
          await this.execute("setSticky", options);
          return w;
      }
      async setAllowWorkspaceDrop(w, allowWorkspaceDrop) {
          const options = {
              windowId: w.id,
              options: {
                  allowWorkspaceDrop
              }
          };
          await this.execute("setAllowWorkspaceDrop", options);
          return w;
      }
      async pin(windowToPin) {
          const options = {
              windowId: windowToPin.id
          };
          await this.execute("pinTab", options);
          return windowToPin;
      }
      async unpin(pinnedWindow) {
          const options = {
              windowId: pinnedWindow.id
          };
          await this.execute("unpinTab", options);
          return pinnedWindow;
      }
      async moveResize(w, bounds) {
          if (typeof window !== "undefined" && window.glueDesktop.versionNum < 31200) {
              return new Promise(async (res, rej) => {
                  const resolveImmediately = this.areBoundsEqual(bounds, w);
                  let isDone = false;
                  const done = () => {
                      if (isDone) {
                          return;
                      }
                      isDone = true;
                      if (unsubscribeBoundsChanged) {
                          unsubscribeBoundsChanged();
                          unsubscribeBoundsChanged = undefined;
                      }
                      res(w);
                      if (resolveTimeout) {
                          clearTimeout(resolveTimeout);
                          resolveTimeout = undefined;
                      }
                  };
                  let resolveTimeout;
                  let unsubscribeBoundsChanged;
                  if (!resolveImmediately) {
                      unsubscribeBoundsChanged = w.onBoundsChanged((win) => {
                          if (!this.areBoundsEqual(bounds, win)) {
                              return;
                          }
                          done();
                      });
                  }
                  try {
                      await this.execute("moveResize", { windowId: w.id, options: { bounds } });
                  }
                  catch (error) {
                      rej(error);
                      return;
                  }
                  if (resolveImmediately) {
                      done();
                      return;
                  }
                  resolveTimeout = setTimeout(() => {
                      done();
                  }, 1000);
              });
          }
          else {
              await this.execute("moveResize", { windowId: w.id, options: { bounds } });
          }
          return w;
      }
      async addFrameButton(w, buttonInfo) {
          await this.execute("addButton", { windowId: w.id, options: buttonInfo }, "ButtonAdded");
          return w;
      }
      async removeFrameButton(w, buttonId) {
          await this.execute("removeButton", { windowId: w.id, options: buttonId }, "ButtonRemoved");
          return w;
      }
      async activate(w) {
          await this.execute("activate", { windowId: w.id });
          return w;
      }
      async focus(w) {
          await this.execute("focus", { windowId: w.id });
          return w;
      }
      async maximizeRestore(w) {
          await this.execute("maximizeRestore", { windowId: w.id }, "StateChanged");
          return w;
      }
      async maximize(w) {
          await this.execute("maximize", { windowId: w.id }, "StateChanged");
          return w;
      }
      async restore(w) {
          await this.execute("restore", { windowId: w.id }, "StateChanged");
          return w;
      }
      async minimize(w) {
          await this.execute("minimize", { windowId: w.id }, "StateChanged");
          return w;
      }
      async collapse(w) {
          await this.execute("collapse", { windowId: w.id }, "StateChanged");
          return w;
      }
      async expand(w) {
          await this.execute("expand", { windowId: w.id }, "StateChanged");
          return w;
      }
      async toggleCollapse(w) {
          await this.execute("toggleCollapse", { windowId: w.id }, "StateChanged");
          return w;
      }
      async snap(w, targetWindow, options) {
          const args = {
              targetWindowId: targetWindow.id
          };
          args.snappingEdge = options.direction;
          args.autoAlign = options.autoAlign;
          await this.execute("snap", { windowId: w.id, options: args }, "CompositionChanged", `CompositionChanged-${targetWindow.id}`);
          return w;
      }
      async attachTab(w, sourceWindow, options) {
          await this.execute("attachTab", {
              windowId: w.id,
              options: {
                  index: options,
                  sourceWindowId: sourceWindow.id,
                  targetWindowId: w.id,
              }
          }, `WindowFrameAdded-${sourceWindow.id}`, `WindowFrameRemoved-${sourceWindow.id}`);
          return w;
      }
      async detachTab(w, options) {
          const eventKeys = ["WindowFrameRemoved", `WindowFrameAdded`];
          if (!isUndefinedOrNull(options === null || options === void 0 ? void 0 : options.relativeTo)) {
              eventKeys.push(`CompositionChanged`);
              eventKeys.push(`CompositionChanged-${options.relativeTo}`);
          }
          else {
              eventKeys.push("BoundsChanged");
          }
          await this.execute("detachTab", { windowId: w.id, options }, ...eventKeys);
          return w;
      }
      async setVisible(w, toBeVisible = true) {
          let command;
          if (toBeVisible) {
              command = "show";
          }
          else {
              command = "hide";
          }
          await this.execute(command, { windowId: w.id }, "VisibilityChanged");
          return w;
      }
      async center(w, display) {
          await this.execute("center", { windowId: w.id, options: display });
          return w;
      }
      async showLoader(w, loader) {
          await this.execute("showLoadingAnimation", { windowId: w.id, options: loader });
          return w;
      }
      async hideLoader(w) {
          await this.execute("hideLoadingAnimation", { windowId: w.id });
          return w;
      }
      async updateContext(w, context, replace) {
          let un;
          try {
              const contextWithoutUndefinedValues = this.swapUndefinedToNull(context);
              const done = new Promise((resolve, reject) => {
                  un = w.onContextUpdated(() => {
                      resolve();
                  });
              });
              await Promise.all([this.execute("updateContext", {
                      windowId: w.id, context: contextWithoutUndefinedValues, replace
                  }), done]);
              return w;
          }
          finally {
              if (un) {
                  un();
              }
          }
      }
      async lock(w) {
          await this.execute("lockUnlock", { windowId: w.id, options: { lock: true } }, "FrameIsLockedChanged");
          return w;
      }
      async unlock(w) {
          await this.execute("lockUnlock", { windowId: w.id, options: { lock: false } }, "FrameIsLockedChanged");
          return w;
      }
      async getIcon(w) {
          const result = await this.execute("getIcon", {
              windowId: w.id,
              options: {}
          });
          return result.icon;
      }
      async setIcon(w, base64Image) {
          await this.execute("setIcon", {
              windowId: w.id,
              options: {
                  dataURL: base64Image
              }
          });
          return w;
      }
      async setFrameColor(w, frameColor) {
          await this.execute("setFrameColor", { windowId: w.id, options: { frameColor } }, "FrameColorChanged");
          return w;
      }
      async setTabHeaderVisible(w, toBeTabHeaderVisible) {
          await this.execute("setTabHeaderVisible", {
              windowId: w.id,
              options: {
                  toShow: toBeTabHeaderVisible
              }
          }, "TabHeaderVisibilityChanged");
          return w;
      }
      async showGroupPopup(id, options) {
          const reformatedOptions = this.showPopupCore(id, options);
          await this.executeGroup("showGroupPopup", {
              groupId: id,
              options: reformatedOptions
          });
      }
      async showPopup(targetWindow, options) {
          const reformatedOptions = this.showPopupCore(targetWindow.id, options);
          await this.execute("showPopupWindow", {
              windowId: targetWindow.id,
              options: reformatedOptions
          });
          return targetWindow;
      }
      async createFlydown(windowId, options) {
          if (!options) {
              throw new Error("The options object is not valid!");
          }
          const optionsCopy = { ...options };
          if (!optionsCopy.horizontalOffset) {
              optionsCopy.horizontalOffset = 0;
          }
          if (!optionsCopy.verticalOffset) {
              optionsCopy.verticalOffset = 0;
          }
          const fullOptions = this.reformatFlydownOptions(windowId, optionsCopy);
          return this.execute("setFlydownArea", { windowId, options: fullOptions }).then(() => {
              const zoneIds = fullOptions.zones.map((z) => z.id);
              fullOptions.zones.forEach((z) => {
                  let callback = typeof (z.flydownSize) === "function" ?
                      z.flydownSize : () => z.flydownSize;
                  if (options.size instanceof Function && z.flydownSize) {
                      callback = async (data, cancel) => {
                          let result;
                          if (options.size instanceof Function) {
                              result = await options.size(data, cancel);
                          }
                          if (z.flydownSize instanceof Function && z.flydownSize !== options.size) {
                              return await z.flydownSize(data, cancel) || result;
                          }
                          return result || z.flydownSize;
                      };
                  }
                  this._registry.clearKey(`${fullOptions.targetId}_${z.id}`);
                  this._registry.add(`${fullOptions.targetId}_${z.id}`, callback);
              });
              return {
                  destroy: () => this.clearFlydownArea(fullOptions.targetId, zoneIds),
                  options: optionsCopy
              };
          });
      }
      async setModalState(windowId, isModal) {
          return this.execute("setModalState", { windowId, options: { isModal } });
      }
      async autoArrange(displayId) {
          return this.execute("autoArrange", { options: { displayId } });
      }
      async handleFlydownBoundsRequested(targetId, data) {
          const cancelCallback = () => data.cancel = true;
          const callbackData = {
              zoneId: data.flydownId,
              flydownWindowBounds: data.flydownWindowBounds,
              flydownWindowId: data.flydownWindowId,
          };
          const responses = await Promise.all(this._registry.execute(`${targetId}_${data.flydownId}`, callbackData, cancelCallback));
          if (responses.length === 1) {
              const defaultResponse = { height: 0, width: 0, top: 0, left: 0 };
              const response = typeof (responses[0]) === "object" && !Array.isArray(responses[0]) ? responses[0] : defaultResponse;
              const responseOptions = { ...data, flydownWindowBounds: response };
              return responseOptions;
          }
      }
      async handleOnEventRequested(callbackId, args) {
          var _a;
          const callbacks = (_a = this.unsubCallbacks[callbackId]) !== null && _a !== void 0 ? _a : [];
          let prevented = false;
          const preventArgs = [];
          await Promise.all(callbacks.map((cb) => {
              return new Promise((resolve, reject) => {
                  cb(() => {
                      resolve();
                  }, () => {
                      reject();
                  }, (pArgs) => {
                      prevented = true;
                      preventArgs.push(pArgs);
                  }, args);
              });
          }));
          return { prevented, preventArgs };
      }
      async zoomIn(window) {
          await this.execute("zoomIn", {
              windowId: window.id,
          });
          return window;
      }
      async zoomOut(window) {
          await this.execute("zoomOut", {
              windowId: window.id,
          });
          return window;
      }
      async setZoomFactor(window, zoomFactor) {
          await this.execute("setZoomFactor", {
              windowId: window.id,
              options: {
                  zoomFactor
              }
          });
          return window;
      }
      async showDevTools(window) {
          await this.execute("showDevTools", {
              windowId: window.id,
          });
          return window;
      }
      async capture(window, options) {
          const base64screenshot = (await this.execute("captureScreenshot", { windowId: window.id, options: { ...options } })).data;
          return base64screenshot;
      }
      async captureGroup(windowIds, options) {
          const base64screenshot = (await this.execute("captureGroupScreenshot", { windowId: windowIds[0], options: { groupWindowIds: windowIds, ...options } })).data;
          return base64screenshot;
      }
      async flash(resultWindow, options) {
          await this.execute("flash", { windowId: resultWindow.id, options: { ...options } });
          return resultWindow;
      }
      async flashTab(resultWindow, options) {
          await this.execute("flashTab", { windowId: resultWindow.id, options: { ...options } });
          return resultWindow;
      }
      async configure(windowId, options) {
          return this.execute("configure", { windowId, options: { ...options } });
      }
      async print(resultWindow, options) {
          await this.execute("print", { windowId: resultWindow.id, options: { ...options } });
          return resultWindow;
      }
      async printToPDF(resultWindow, options) {
          const filePath = (await this.execute("printToPDF", { windowId: resultWindow.id, options: { ...options } })).filePath;
          return filePath;
      }
      async place(window, options) {
          const copy = { ...options };
          if (!options.display || options.display === "current") {
              copy.display = await window.getDisplay();
          }
          if (copy.display && typeof copy.display !== "string" && typeof copy.display !== "number") {
              copy.display = copy.display.index + 1;
          }
          return this.execute("place", { windowId: window.id, options: { ...copy } });
      }
      async refresh(resultWindow, ignoreCache) {
          await this.execute("refresh", { windowId: resultWindow.id, options: { ignoreCache } });
          return resultWindow;
      }
      async download(resultWindow, url, options = {}) {
          options.enableDownloadBar = !options.silent;
          const result = await this.execute("downloadURL", { windowId: resultWindow.id, options: { url, options } });
          return {
              url,
              path: result.fullPath,
              size: result.fileSize,
          };
      }
      async configureWindow(resultWindow, options) {
          await this.execute("configureWindow", { windowId: resultWindow.id, options });
          return resultWindow;
      }
      async getWindowConfiguration(resultWindow) {
          const config = await this.execute("getWindowConfiguration", { windowId: resultWindow.id });
          return config;
      }
      async startDrag(resultWindow, options) {
          await this.execute("startDrag", { windowId: resultWindow.id, options });
          return resultWindow;
      }
      showDialog(resultWindow, options) {
          return new Promise((res, rej) => {
              const token = Utils.generateId();
              const un = this._registry.add("event", (args) => {
                  if (args.type === "DialogResult" && args.windowId === resultWindow.id && args.data.token === token) {
                      un();
                      const data = args.data;
                      if ("status" in data) {
                          if (data.status === "failed") {
                              rej(new Error(data.message));
                          }
                          else if (data.status === "successful") {
                              res(data.result);
                          }
                      }
                  }
              });
              this.execute("showDialog", { windowId: resultWindow.id, options: Object.assign({}, { ...options }, { token }) });
          });
      }
      async execute(command, options, ...eventKeys) {
          return this.executeCore(this.WndMethodName, command, options, ...eventKeys);
      }
      async executeGroup(command, options, ...eventKeys) {
          return this.executeCore(this.GroupMethodName, command, options, ...eventKeys);
      }
      async ungroup(w, options) {
          const args = {
              windowId: w.id,
              options
          };
          await this.execute("ungroup", args);
          return w;
      }
      async updateJumpList(windowId, options) {
          const args = {
              windowId,
              options
          };
          await this.execute("updateJumplist", args);
      }
      async getJumpList(windowId) {
          const args = {
              windowId,
          };
          const result = await this.execute("getJumplist", args);
          return result;
      }
      onClosing(callback, gdWindow) {
          const glue42gd = typeof window !== "undefined" && window.glue42gd;
          if (glue42gd && gdWindow.windowType === "electron") {
              return glue42gd.addCloseHandler(callback, gdWindow.id);
          }
          else {
              return this.nonWindowHandlers(callback, gdWindow.id, "OnClosing");
          }
      }
      onGroupClosing(callback, group) {
          return this.nonWindowHandlersCore(group.id, "OnClosing", true, callback);
      }
      onRefreshing(callback, gdWindow) {
          const glue42gd = typeof window !== "undefined" && window.glue42gd;
          if (glue42gd && gdWindow.windowType === "electron") {
              return glue42gd.addRefreshHandler(callback, gdWindow.id);
          }
          else {
              return this.nonWindowHandlers(callback, gdWindow.id, "OnRefreshing");
          }
      }
      onNavigating(callback, gdWindow) {
          const glue42gd = typeof window !== "undefined" && window.glue42gd;
          if (glue42gd && gdWindow.windowType === "electron") {
              return glue42gd.addWillNavigateHandler(callback, gdWindow.id);
          }
          else {
              return this.nonWindowHandlers(callback, gdWindow.id, "OnNavigating");
          }
      }
      async clone(window, cloneOptions) {
          const args = {
              windowId: window.id,
              options: cloneOptions
          };
          const result = await this.execute("clone", args);
          const win = await windowStore.waitFor(result.id);
          return win.API;
      }
      async executeCode(targetWindow, code) {
          const args = {
              windowId: targetWindow.id,
              options: {
                  code
              }
          };
          return this.execute("executeCode", args);
      }
      async goBack(resultWindow) {
          await this.execute("goBack", { windowId: resultWindow.id });
      }
      async goForward(resultWindow) {
          await this.execute("goForward", { windowId: resultWindow.id });
      }
      async getDockingPlacement(window) {
          return this.execute("getDockingPlacement", { windowId: window.id });
      }
      dock(window, options) {
          return this.execute("dock", { windowId: window.id, options });
      }
      clearCallbacks(id) {
          const keys = Object.keys(this.unsubCallbacks);
          keys.forEach((key) => {
              if (key.startsWith(id)) {
                  delete this.unsubCallbacks[key];
              }
          });
      }
      nonWindowHandlers(callback, targetId, type) {
          return this.nonWindowHandlersCore(targetId, type, false, callback);
      }
      nonWindowHandlersCore(targetId, type, isGroup, callback) {
          const id = `${targetId}-${type}`;
          const unsub = () => {
              var _a;
              if (this.unsubCallbacks[id]) {
                  const callbacks = this.unsubCallbacks[id];
                  this.unsubCallbacks[id] = callbacks.filter((cb) => cb !== callback);
                  if (this.unsubCallbacks[id].length === 0) {
                      delete this.unsubCallbacks[id];
                  }
              }
              const cbs = (_a = this.unsubCallbacks[id]) !== null && _a !== void 0 ? _a : [];
              if (cbs.length === 0) {
                  const options = {
                      unsubscribe: true
                  };
                  if (isGroup) {
                      this.executeGroup(type, {
                          groupId: targetId,
                          options
                      });
                  }
                  else {
                      this.execute(type, {
                          windowId: targetId,
                          options
                      });
                  }
              }
          };
          if (this.unsubCallbacks[id]) {
              this.unsubCallbacks[id].push(callback);
              return unsub;
          }
          else {
              this.unsubCallbacks[id] = [callback];
          }
          if (isGroup) {
              this.executeGroup(type, { groupId: targetId });
          }
          else {
              this.execute(type, { windowId: targetId });
          }
          return unsub;
      }
      reformatFlydownOptions(windowId, options) {
          const assignGeneralIfUnassigned = (zone, prop) => {
              if (options[prop] && (zone[prop] === undefined || zone[prop] === null)) {
                  const valueFromOptions = options[prop];
                  zone[prop] = valueFromOptions;
              }
          };
          const zones = options.zones.map((z) => {
              assignGeneralIfUnassigned(z, "windowId");
              assignGeneralIfUnassigned(z, "targetLocation");
              if (options.size && (z.flydownSize === undefined || z.flydownSize === null)) {
                  z.flydownSize = options.size;
              }
              z.flydownBounds = z.flydownSize;
              z.flydownId = z.windowId;
              if (!z.targetLocation) {
                  z.targetLocation = "bottom";
              }
              return z;
          });
          return {
              ...options,
              zones,
              targetId: windowId,
              flydownBounds: options.size,
              flydownActiveArea: options.activeArea
          };
      }
      clearFlydownArea(windowId, areaIds) {
          return this.execute("clearFlydownWindowArea", {
              windowId,
              options: {}
          }).then(() => {
              areaIds.forEach((id) => {
                  this._registry.clearKey(`${windowId}_${id}`);
              });
          });
      }
      executeWithoutToken(params, ...eventKeys) {
          const uns = [];
          const executed = eventKeys === null || eventKeys === void 0 ? void 0 : eventKeys.filter((k) => !isUndefinedOrNull(k)).map((key) => {
              return new Promise((r) => {
                  const [type, windowId = params.windowId] = key.split("-");
                  uns.push(this._registry.add("event", (data) => {
                      if (data.type === type && data.windowId === windowId) {
                          r();
                      }
                  }));
              });
          });
          const action = new Promise((resolve, reject) => {
              this.agm.invoke("T42.Wnd.Execute", params, this.agmTarget, {
                  waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
                  methodResponseTimeoutMs: INTEROP_METHOD_RESPONSE_TIMEOUT_MS
              })
                  .then((i) => {
                  if (i.returned && i.returned.errorMsg) {
                      reject(i);
                  }
                  else {
                      resolve(i.returned);
                  }
              })
                  .catch((e) => reject(e));
          });
          return Promise.all([action, ...executed])
              .then((r) => {
              return r[0];
          })
              .finally(() => {
              uns.forEach((un) => un());
          });
      }
      async executeCore(methodName, command, options, ...eventKeys) {
          const { invocationOptions, ...invocationArgs } = options;
          const params = {
              ...invocationArgs,
              command,
          };
          let finishedResolve;
          this._finished = new Promise((resolve) => {
              finishedResolve = resolve;
          });
          try {
              if (typeof window !== "undefined" && window.glueDesktop.versionNum < 31200) {
                  return await this.executeWithoutToken(params, ...eventKeys);
              }
              else {
                  return await this.executeWithToken(methodName, params, invocationOptions);
              }
          }
          finally {
              finishedResolve();
          }
      }
      async executeWithToken(methodName, options, invocationOptions) {
          let un;
          try {
              const token = Utils.generateId();
              const event = new Promise((r) => {
                  un = this._registry.add("event", (data) => {
                      if (data.token === token) {
                          r();
                      }
                  });
              });
              const execute = new Promise((resolve, reject) => {
                  options.token = token;
                  if (!invocationOptions) {
                      invocationOptions = {
                          waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
                          methodResponseTimeoutMs: INTEROP_METHOD_RESPONSE_TIMEOUT_MS
                      };
                  }
                  else if (!invocationOptions.methodResponseTimeoutMs) {
                      invocationOptions.methodResponseTimeoutMs = INTEROP_METHOD_RESPONSE_TIMEOUT_MS;
                  }
                  else if (!invocationOptions.waitTimeoutMs) {
                      invocationOptions.waitTimeoutMs = INTEROP_METHOD_WAIT_TIMEOUT_MS;
                  }
                  this.agm.invoke(methodName, options, this.agmTarget, invocationOptions)
                      .then((i) => {
                      if (i.returned && i.returned.errorMsg) {
                          reject(new Error(i.returned.errorMsg));
                      }
                      else {
                          resolve(i.returned);
                      }
                  })
                      .catch((e) => {
                      const error = Utils.typedError(e);
                      reject(error);
                  });
              });
              const result = await Promise.all([execute, event]);
              return result[0];
          }
          finally {
              if (un) {
                  un();
              }
          }
      }
      areBoundsEqual(requested, w) {
          const current = w.bounds;
          const settings = w.settings;
          let height = requested.height;
          let width = requested.width;
          if (requested.height < settings.minHeight) {
              height = settings.minHeight;
          }
          if (requested.height > settings.maxHeight) {
              height = settings.maxHeight;
          }
          if (requested.width < settings.minWidth) {
              width = settings.minWidth;
          }
          if (requested.width > settings.maxWidth) {
              width = settings.maxWidth;
          }
          const areHeightsEqual = height ? current.height === height : true;
          const areWidthsEqual = width ? current.width === width : true;
          const areLeftsEqual = requested.left ? current.left === requested.left : true;
          const areTopsEqual = requested.top ? current.top === requested.top : true;
          return areHeightsEqual && areWidthsEqual && areLeftsEqual && areTopsEqual;
      }
      swapUndefinedToNull(context) {
          try {
              const copy = {};
              for (const key of Object.keys(context)) {
                  let value = context[key];
                  if (typeof value === "undefined") {
                      value = null;
                  }
                  copy[key] = value;
              }
              return copy;
          }
          catch {
              return context;
          }
      }
      showPopupCore(id, options) {
          if (!options) {
              throw new Error("The options object is not valid!");
          }
          const optionsCopy = { ...options };
          if (!optionsCopy.targetLocation) {
              optionsCopy.targetLocation = "bottom";
          }
          const reformatedOptions = {
              ...optionsCopy,
              popupBounds: optionsCopy.size,
              targetId: id,
              popupId: optionsCopy.windowId
          };
          return reformatedOptions;
      }
  }
  var executor = new GDExecutor();

  class GDEnvironment {
      constructor(agm, logger, appManagerGetter, displayAPIGetter, channelsAPIGetter, wndId, groupId) {
          this._registry = CallbackRegistryFactory();
          this._agm = agm;
          this._logger = logger.subLogger("gd-env");
          this._windowId = wndId;
          this._groupId = groupId;
          this._appManagerGetter = appManagerGetter;
          this._displayAPIGetter = displayAPIGetter;
          this._channelsAPIGetter = channelsAPIGetter;
      }
      init() {
          return new Promise((resolve, reject) => {
              this._agm.register("T42.Wnd.OnEventWithResponse", (args, caller) => {
                  return this.respondToEvent(args);
              });
              new Promise((streamResolve, streamReject) => {
                  this._agm.subscribe("T42.Wnd.OnEvent", {
                      target: "best",
                      arguments: {
                          withConfig: true
                      },
                      onData: (streamData) => {
                          if (streamData.data.type === "Configuration") {
                              this._configuration = streamData.data;
                              executor.setConfiguration(this._configuration);
                              return;
                          }
                          this.updateWindow(streamData.data, resolve);
                          executor.handleEvent(streamData.data);
                      },
                      onConnected: (instance) => {
                          this._agmInstance = instance;
                          executor.init(this._agm, this._agmInstance);
                      }
                  }).catch((error) => {
                      var _a;
                      const message = `${(_a = error === null || error === void 0 ? void 0 : error.method) === null || _a === void 0 ? void 0 : _a.name} - ${JSON.stringify(error === null || error === void 0 ? void 0 : error.called_with)} - ${error === null || error === void 0 ? void 0 : error.message}`;
                      reject(new Error(message));
                  });
              });
          });
      }
      get executor() {
          return executor;
      }
      open(name, url, options) {
          options = options || {};
          const copyOptions = { ...options };
          if (copyOptions.relativeTo !== undefined && typeof copyOptions.relativeTo !== "string") {
              copyOptions.relativeTo = copyOptions.relativeTo.id || "";
          }
          copyOptions.name = name;
          copyOptions.url = url;
          copyOptions.windowState = options.windowState || options.state;
          delete copyOptions.state;
          return this.executor.open(copyOptions);
      }
      createFlydown(windowId, options) {
          return this.executor.createFlydown(windowId, options);
      }
      async showPopup(windowId, options) {
          const window = windowStore.get(windowId);
          await this.executor.showPopup(window.API, options);
      }
      tabAttached(callback) {
          return this._registry.add("tab-attached", callback);
      }
      tabDetached(callback) {
          return this._registry.add("tab-detached", callback);
      }
      onWindowFrameColorChanged(callback) {
          return this._registry.add("frame-color-changed", callback);
      }
      onEvent(callback) {
          return this._registry.add("window-event", callback);
      }
      my() {
          return this._windowId;
      }
      myGroup() {
          return this._groupId;
      }
      onCompositionChanged(callback) {
          return this._registry.add("composition-changed", callback);
      }
      onGroupHeaderVisibilityChanged(callback) {
          return this._registry.add("group-header-changed", callback);
      }
      onGroupVisibilityChanged(callback) {
          return this._registry.add("group-visibility-changed", callback);
      }
      onGroupStateChanged(callback) {
          return this._registry.add("group-state-changed", callback);
      }
      onWindowGotFocus(callback) {
          return this._registry.add("got-focus", callback);
      }
      onWindowLostFocus(callback) {
          return this._registry.add("lost-focus", callback);
      }
      onWindowsAutoArrangeChanged(callback) {
          return this._registry.add("windows-auto-arranged-changed", callback);
      }
      respondToEvent(args) {
          if (args.type === "ShowFlydownBoundsRequested") {
              return this.executor.handleFlydownBoundsRequested(args.data.windowId, args.data);
          }
          else if (args.type === "OnClosing" || args.type === "OnRefreshing" || args.type === "OnNavigating") {
              return this.executor.handleOnEventRequested(args.data.callbackId, args.data.args);
          }
          return Promise.reject(`There isn't a handler for ${args.type}`);
      }
      updateWindow(windowInfo, readyResolve) {
          const extendedStreamEvent = this.getExtendedStreamEvent(windowInfo);
          if (windowInfo.type === "Snapshot") {
              const windowInfoFullInfoEvent = windowInfo;
              windowInfoFullInfoEvent.windows.forEach((w) => {
                  const existingWindow = windowStore.get(w.id);
                  if (existingWindow) {
                      existingWindow.Events.handleUpdate(this.mapToWindowConstructorOptions(w));
                      existingWindow.GroupCreationArgs = this.mapToGroupCreationArgs(w);
                  }
                  else {
                      this.createWindowFromSnapshot(w.id, w);
                  }
                  this._registry.execute("window-event", extendedStreamEvent);
              });
              readyResolve(this);
              return;
          }
          if (windowInfo.type === "CommandExecuted") {
              this._registry.execute("window-event", extendedStreamEvent);
              return;
          }
          if (windowInfo.type === "Created") {
              const windowInfoCreatedEvent = (windowInfo);
              this.createWindowFromStream(windowInfoCreatedEvent.windowId, windowInfoCreatedEvent.data || {});
              this._registry.execute("window-event", extendedStreamEvent);
              return;
          }
          if (windowInfo.type === "OnGroupVisibilityChanged") {
              const info = windowInfo;
              this._registry.execute("group-visibility-changed", info.data);
              this._registry.execute("window-event", windowInfo);
              return;
          }
          if (windowInfo.type === "OnGroupStateChanged") {
              const info = windowInfo;
              this._registry.execute("group-state-changed", info.data);
              this._registry.execute("window-event", windowInfo);
              return;
          }
          if (windowInfo.type === "OnWindowsAutoArrangeChanged") {
              const info = windowInfo;
              this._registry.execute("windows-auto-arranged-changed", info.data);
              this._registry.execute("window-event", windowInfo);
              return;
          }
          const windowObjectAndEvents = windowStore.get((windowInfo).windowId);
          if (!windowObjectAndEvents) {
              this._logger.error(`received update for unknown window. Stream:', ${JSON.stringify(windowInfo, null, 4)}`);
              return;
          }
          const theWindow = windowObjectAndEvents.API;
          const theWindowEvents = windowObjectAndEvents.Events;
          if (windowInfo.type === "BoundsChanged") {
              const windowInfoBoundsChangedEvent = windowInfo;
              theWindowEvents.handleBoundsChanged(windowInfoBoundsChangedEvent.data);
          }
          if (windowInfo.type === "UrlChanged") {
              const windowInfoUrlChangedEvent = windowInfo;
              windowStore.setUrlChangedState(windowInfoUrlChangedEvent.windowId);
              theWindowEvents.handleUrlChanged(windowInfoUrlChangedEvent.data);
          }
          if (windowInfo.type === "TitleChanged") {
              const windowInfoTitleChanged = windowInfo;
              theWindowEvents.handleTitleChanged(windowInfoTitleChanged.data);
          }
          if (windowInfo.type === "IsStickyChanged") {
              const windowInfoIsStickyChangedChanged = windowInfo;
              theWindowEvents.handleIsStickyChanged(windowInfoIsStickyChangedChanged.data);
          }
          if (windowInfo.type === "VisibilityChanged") {
              theWindowEvents.handleVisibilityChanged(windowInfo.data);
          }
          if (windowInfo.type === "ContextChanged") {
              theWindowEvents.handleContextUpdated(windowInfo.data);
          }
          if (windowInfo.type === "StateChanged") {
              theWindowEvents.handleWindowChangeState(windowInfo.data);
          }
          if (windowInfo.type === "FrameColorChanged") {
              theWindowEvents.handleFrameColorChanged(windowInfo.data);
              this._registry.execute("frame-color-changed", theWindow);
          }
          if (windowInfo.type === "CompositionChanged") {
              const windowInfoCompositionChanged = windowInfo;
              theWindowEvents.handleCompositionChanged(windowInfoCompositionChanged.data);
              windowStore.setCompositionChangedState(windowObjectAndEvents);
              this._registry.execute("composition-changed", windowInfoCompositionChanged.data);
          }
          if (windowInfo.type === "GroupHeaderVisibilityChanged") {
              const info = windowInfo;
              theWindowEvents.handleGroupHeaderVisibilityChanged(info.data.groupHeaderVisible);
              this._registry.execute("group-header-changed", info.data);
          }
          if (windowInfo.type === "FocusChanged") {
              const windowInfoFocusChanged = windowInfo;
              this.focusChanged(theWindowEvents, theWindow, windowInfoFocusChanged.data);
          }
          if (windowInfo.type === "WindowFrameChanged") {
              theWindowEvents.handleFrameAttached(windowInfo.data.frameId, windowInfo.data.frameId, windowInfo.data.isTabHeaderVisible);
              this._registry.execute("frame-changed");
          }
          if (windowInfo.type === "WindowFrameAdded") {
              const winsToBeNotified = getWindowsByTabGroupId(theWindow.id, windowInfo.data.frameId);
              const data = windowInfo.data;
              theWindowEvents.handleAttached(data.frameId, data.frameId, data.isTabHeaderVisible, data.isLocked, winsToBeNotified)
                  .then(async () => {
                  if (winsToBeNotified.length > 0) {
                      await executor.finished;
                      this._registry.execute("tab-attached", theWindow, windowInfo.data.frameId, windowInfo.data.isTabHeaderVisible);
                  }
              });
          }
          if (windowInfo.type === "WindowFrameRemoved") {
              const oldTabGroupId = theWindow.tabGroupId;
              const winsToBeNotified = getWindowsByTabGroupId(theWindow.id, oldTabGroupId);
              theWindowEvents.handleDetached(windowInfo.data.isLocked, winsToBeNotified)
                  .then(async () => {
                  if (winsToBeNotified.length > 0) {
                      await executor.finished;
                      this._registry.execute("tab-detached", theWindow, windowInfo.data.frameId, theWindow.tabGroupId);
                  }
              });
          }
          if (windowInfo.type === "TabHeaderVisibilityChanged") {
              theWindowEvents.handleTabHeaderVisibilityChanged(windowInfo.data.isTabHeaderVisible);
          }
          if (windowInfo.type === "FrameSelectionChanged") {
              theWindowEvents.handleFrameSelectionChanged(windowInfo.data.newWindowId, windowInfo.data.prevWindowId);
          }
          if (windowInfo.type === "ButtonClicked") {
              theWindowEvents.handleFrameButtonClicked(windowInfo.data);
          }
          if (windowInfo.type === "ButtonAdded") {
              theWindowEvents.handleFrameButtonAdded(windowInfo.data);
          }
          if (windowInfo.type === "ButtonRemoved") {
              theWindowEvents.handleFrameButtonRemoved(windowInfo.data);
          }
          if (windowInfo.type === "WindowZoomFactorChanged") {
              theWindowEvents.handleZoomFactorChanged(windowInfo.data);
          }
          if (windowInfo.type === "Closed") {
              windowStore.remove(windowObjectAndEvents);
              theWindowEvents.handleWindowClose();
          }
          if (windowInfo.type === "FrameIsLockedChanged") {
              theWindowEvents.handleFrameIsLockedChanged(windowInfo.data);
          }
          if (windowInfo.type === "PlacementSettingsChanged") {
              theWindowEvents.handlePlacementSettingsChanged(windowInfo.data);
          }
          if (windowInfo.type === "DockingChanged") {
              theWindowEvents.handleDockingChanged(windowInfo.data);
          }
          if (windowInfo.type === "AllowWorkspaceDropChanged") {
              theWindowEvents.handleAllowWorkspaceDropChanged(windowInfo.data);
          }
          if (windowInfo.type === "IsPinnedChanged") {
              theWindowEvents.handleIsPinnedChanged(windowInfo.data);
          }
          if (windowInfo.type === "WindowChannelRestrictionsChanged") {
              theWindowEvents.handleChannelRestrictionsChanged(windowInfo.data);
          }
          this._registry.execute("window-event", extendedStreamEvent);
      }
      createWindowFromSnapshot(windowId, options) {
          const windowObjAndEvents = this.createWindowCore(windowId, options);
          windowStore.add(windowObjAndEvents, {
              ready: true,
              urlChanged: true,
              compositionChanged: true
          });
      }
      createWindowFromStream(windowId, options) {
          var _a;
          const windowObjAndEvents = this.createWindowCore(windowId, options);
          const isRemote = windowObjAndEvents.API.windowType === "remote";
          const isFrameless = windowObjAndEvents.API.windowType === "electron" && windowObjAndEvents.API.mode === "frameless";
          const isHidden = windowObjAndEvents.API.isVisible === false;
          let urlChanged = false;
          let compositionChanged = false;
          if (isRemote) {
              urlChanged = true;
          }
          if (isFrameless || isHidden) {
              compositionChanged = true;
          }
          if (!isRemote) {
              urlChanged = !((_a = this._configuration) === null || _a === void 0 ? void 0 : _a.windowAvailableOnURLChanged);
          }
          windowStore.add(windowObjAndEvents, {
              ready: true,
              urlChanged,
              compositionChanged
          });
      }
      createWindowCore(windowId, options) {
          const windowObjAndEvents = windowFactory(windowId, this.mapToWindowConstructorOptions(options), executor, this._logger, this._appManagerGetter, this._displayAPIGetter, this._channelsAPIGetter, this._agm);
          windowObjAndEvents.GroupCreationArgs = this.mapToGroupCreationArgs(options);
          return windowObjAndEvents;
      }
      async focusChanged(theWindowEvents, theWindow, focus) {
          theWindowEvents.handleFocusChanged(focus);
          try {
              if (!this._configuration.windowAvailableOnURLChanged) {
                  await windowStore.waitFor(theWindow.id);
              }
          }
          catch (error) {
              return;
          }
          if (focus) {
              this._registry.execute("got-focus", theWindow);
          }
          else {
              this._registry.execute("lost-focus", theWindow);
          }
      }
      mapToWindowConstructorOptions(args) {
          return {
              name: args.name,
              context: args.context,
              bounds: args.bounds,
              url: args.url,
              title: args.title,
              isVisible: args.isVisible,
              focus: args.isFocused,
              state: args.state,
              frameColor: args.frameColor,
              groupId: args.groupId,
              neighbours: args.neighbors,
              isFocused: args.isFocused,
              isGroupHeaderVisible: args.groupHeaderVisible,
              isCollapsed: args.isCollapsed,
              tabGroupId: args.frameId,
              frameId: args.frameId,
              mode: args.mode,
              isTabHeaderVisible: args.isTabHeaderVisible,
              isTabSelected: args.isActiveTab,
              settings: args.settings,
              windowType: args.windowType,
              zoomFactor: args.zoomFactor,
              isLocked: args.isLocked,
              placementSettings: args.placementSettings,
              isSticky: args.isSticky,
              tabIndex: args.tabIndex,
              frameButtons: args.frameButtons,
              jumpListOptions: args.jumpList,
              applicationName: args.applicationName,
              allowWorkspaceDrop: args.allowWorkspaceDrop,
              isPinned: args.isPinned
          };
      }
      mapToGroupCreationArgs(args) {
          return {
              isGroupHibernated: args.isGroupHibernated,
              isGroupVisible: args.isGroupVisible
          };
      }
      getExtendedStreamEvent(streamEvent) {
          try {
              if (!streamEvent.windowId) {
                  return streamEvent;
              }
              const window = windowStore.get(streamEvent.windowId);
              if (!window) {
                  return streamEvent;
              }
              const result = {
                  state: streamEvent.type,
                  windowName: window.API.name,
                  ...streamEvent
              };
              if (result.state === "WindowFrameAdded") {
                  result.state = "TabAttached";
              }
              if (result.state === "StateChanged") {
                  result.state = result.data.charAt(0).toUpperCase() + result.data.slice(1);
              }
              if (result.state === "ButtonAdded") {
                  result.state = "FrameButtonAdded";
              }
              if (result.state === "ButtonRemoved") {
                  result.state = "FrameButtonRemoved";
              }
              return result;
          }
          catch (error) {
              return streamEvent;
          }
      }
  }

  var envDetector = (agm, logger, appManagerGetter, displayAPIGetter, channelsAPIGetter, gdMajorVersion) => {
      var _a;
      const _logger = logger;
      if (gdMajorVersion === 2) {
          _logger.trace("running in HC");
          throw new Error("GD2 not supported");
      }
      else if (gdMajorVersion >= 3) {
          _logger.trace("running in GD 3");
          return new GDEnvironment(agm, _logger, appManagerGetter, displayAPIGetter, channelsAPIGetter, window.glue42gd.windowId, (_a = window.webGroupsManager) === null || _a === void 0 ? void 0 : _a.id).init();
      }
      else {
          _logger.trace("running in Browser or Node");
          return new GDEnvironment(agm, _logger, appManagerGetter, displayAPIGetter, channelsAPIGetter).init();
      }
  };

  var groupFactory = (id, executor) => {
      const _registry = CallbackRegistryFactory();
      const _windowsId = [];
      let _isHibernatedFlag;
      let _isVisible;
      async function addWindow(winId) {
          var _a, _b, _c, _d;
          if (_windowsId.indexOf(winId) === -1) {
              _windowsId.push(winId);
              const win = windowStore.get(winId);
              win.Events.handleGroupChanged(groupObject, undefined);
              _isHibernatedFlag = (_b = (_a = win.GroupCreationArgs.isGroupHibernated) !== null && _a !== void 0 ? _a : _isHibernatedFlag) !== null && _b !== void 0 ? _b : false;
              _isVisible = (_d = (_c = win.GroupCreationArgs.isGroupVisible) !== null && _c !== void 0 ? _c : _isVisible) !== null && _d !== void 0 ? _d : true;
              await executor.finished;
              _registry.execute("window-added", groupObject, win.API);
          }
      }
      async function removeWindow(win) {
          const index = _windowsId.indexOf(win.API.id);
          if (index !== -1) {
              _windowsId.splice(index, 1);
              win.Events.handleGroupChanged(undefined, groupObject);
              await executor.finished;
              _registry.execute("window-removed", groupObject, win.API);
          }
      }
      function find(window, success, error) {
          let winId;
          if (typeof window === "string") {
              winId = window;
          }
          else if (!isUndefinedOrNull(window)) {
              winId = window.id;
          }
          const win = _mapToWindowObject(winId);
          if (win) {
              if (typeof success === "function") {
                  success(win);
              }
              return win;
          }
          else {
              if (typeof error === "function") {
                  error(`No window with ID: ${winId}`);
              }
          }
      }
      function windows(success) {
          const mappedWindows = _mapToWindowObjects();
          return mappedWindows;
      }
      async function execute(command, options, ...keys) {
          await executor.execute(command, options, ...keys);
          return groupObject;
      }
      function handleGroupHeaderVisibilityChanged(windowInfo) {
          _registry.execute("header-visibility-changed", groupObject);
      }
      function handleGroupVisibilityChanged(visibile) {
          _isVisible = visibile;
          _registry.execute("group-visibility-changed", groupObject);
      }
      function handleGroupHibernateChanged(isHibernatedFlag) {
          _isHibernatedFlag = isHibernatedFlag;
      }
      function _mapToWindowObjects() {
          const winObjects = [];
          _windowsId.forEach((winId) => {
              const windowObject = _mapToWindowObject(winId);
              if (typeof windowObject !== "undefined") {
                  winObjects.push(windowObject);
              }
          });
          return winObjects;
      }
      function _mapToWindowObject(windowId) {
          return windowStore.get(windowId) ? windowStore.get(windowId).API : undefined;
      }
      function _getGroupHeaderVisibility() {
          const windowWithHiddenHeader = _mapToWindowObjects().find((w) => !w.isGroupHeaderVisible);
          const _isGroupHeaderVisible = windowWithHiddenHeader === undefined;
          return _isGroupHeaderVisible;
      }
      function isHibernated() {
          return _isHibernatedFlag;
      }
      function onHeaderVisibilityChanged(callback) {
          return _registry.add("header-visibility-changed", callback);
      }
      function onWindowAdded(callback) {
          return _registry.add("window-added", callback);
      }
      function onWindowRemoved(callback) {
          return _registry.add("window-removed", callback);
      }
      function onVisibilityChanged(callback) {
          if (!callback) {
              throw new Error("Callback argument is required");
          }
          if (callback && typeof callback !== "function") {
              throw new Error("Callback argument must be a function");
          }
          return _registry.add("group-visibility-changed", callback);
      }
      function onClosing(callback) {
          if (typeof callback !== "function") {
              throw new Error("callback must be a function");
          }
          const callbackWrap = (success, error, prevent) => {
              const promise = callback(prevent);
              if (promise === null || promise === void 0 ? void 0 : promise.then) {
                  promise.then(success).catch(error);
              }
              else {
                  success();
              }
          };
          return executor.onGroupClosing(callbackWrap, groupObject);
      }
      const groupObject = {
          id,
          get windows() {
              return windows();
          },
          find,
          get isHeaderVisible() {
              return _getGroupHeaderVisibility();
          },
          get isHibernated() {
              return isHibernated();
          },
          get isVisible() {
              return _isVisible;
          },
          showHeader: (success, error) => {
              return Utils.callbackifyPromise(() => {
                  return execute("setGroupHeaderVisibility", { windowId: _windowsId[0], options: { toShow: true } }, ..._windowsId.map((w) => `GroupHeaderVisibilityChanged-${w}`));
              }, success, error);
          },
          hideHeader: (success, error) => {
              return Utils.callbackifyPromise(() => {
                  return execute("setGroupHeaderVisibility", { windowId: _windowsId[0], options: { toShow: false } }, ..._windowsId.map((w) => `GroupHeaderVisibilityChanged-${w}`));
              }, success, error);
          },
          getTitle: async () => {
              const r = await executor.execute("getGroupTitle", { windowId: _windowsId[0] });
              return r.title;
          },
          setTitle: async (title) => {
              if (isNullOrWhiteSpace(title)) {
                  throw new Error("`title` must not be null or undefined.");
              }
              return execute("setGroupTitle", { windowId: _windowsId[0], options: { title } });
          },
          capture: (captureOptions) => {
              return executor.captureGroup(_windowsId, captureOptions);
          },
          maximize: (success, error) => {
              return Utils.callbackifyPromise(() => {
                  return execute("maximizeGroup", { windowId: _windowsId[0] }, ..._windowsId.map((w) => `StateChanged-${w}`));
              }, success, error);
          },
          restore: (success, error) => {
              return Utils.callbackifyPromise(() => {
                  return execute("restoreGroup", { windowId: _windowsId[0] }, ..._windowsId.map((w) => `StateChanged-${w}`));
              }, success, error);
          },
          show: (activate) => {
              if (!isUndefinedOrNull(activate) && !isBoolean(activate)) {
                  throw new Error("Activate flag must be a boolean!");
              }
              activate = !isUndefinedOrNull(activate) ? activate : true;
              return executor.executeGroup("showGroup", {
                  groupId: id,
                  options: { activate }
              });
          },
          hide: () => {
              return executor.executeGroup("hideGroup", {
                  groupId: id
              });
          },
          close: () => {
              return executor.executeGroup("closeGroup", {
                  groupId: id
              });
          },
          showPopup: (options) => {
              return executor.showGroupPopup(id, options);
          },
          onHeaderVisibilityChanged,
          onWindowAdded,
          onWindowRemoved,
          onVisibilityChanged,
          onClosing,
      };
      const internal = {
          get windows() {
              return _windowsId;
          },
          addWindow,
          removeWindow,
          handleGroupHeaderVisibilityChanged,
          handleGroupVisibilityChanged,
          handleGroupHibernateChanged
      };
      return {
          groupAPI: groupObject,
          groupInternal: internal,
      };
  };

  var groupsFactory = (environment, logger) => {
      const _registry = CallbackRegistryFactory();
      const _groups = {};
      let heardForWindowsCounter = -1;
      const windows = windowStore.list;
      Object.keys(windows).forEach((k) => {
          const win = windows[k];
          const groupId = win.API.groupId;
          const winId = win.API.id;
          if (!isNullOrWhiteSpace(groupId)) {
              addWindow(groupId, winId);
          }
      });
      windowStore.onRemoved((w) => {
          const group = findGroupWrapperByWindow(w.API);
          removeWindow(group, w);
      });
      environment.onCompositionChanged((windowInfo) => {
          handleCompositionChanged(windowInfo);
      });
      environment.onGroupHeaderVisibilityChanged((windowInfo) => {
          const windowId = windowInfo.windowId;
          const group = findGroupByWindow(windowId);
          if (typeof group !== "undefined") {
              const groupEvents = _groups[group.id];
              if (heardForWindowsCounter === -1) {
                  heardForWindowsCounter = group.windows.length;
              }
              heardForWindowsCounter--;
              if (heardForWindowsCounter === 0) {
                  heardForWindowsCounter = -1;
                  groupEvents.groupInternal.handleGroupHeaderVisibilityChanged(windowInfo);
              }
          }
      });
      environment.onGroupVisibilityChanged((data) => {
          const groupEvents = _groups[data.groupId];
          if (groupEvents) {
              groupEvents.groupInternal.handleGroupVisibilityChanged(data.visible);
          }
      });
      environment.onGroupStateChanged((data) => {
          const groupWrapper = _groups[data.groupId];
          if (data.state === "hibernated") {
              if (groupWrapper === null || groupWrapper === void 0 ? void 0 : groupWrapper.groupAPI) {
                  groupWrapper.groupInternal.handleGroupHibernateChanged(true);
              }
              _registry.execute("group-hibernated", data.groupId);
          }
          else if (data.state === "resumed") {
              if (groupWrapper === null || groupWrapper === void 0 ? void 0 : groupWrapper.groupAPI) {
                  groupWrapper.groupInternal.handleGroupHibernateChanged(false);
              }
              _registry.execute("group-resumed", groupWrapper.groupAPI);
          }
      });
      function my() {
          var _a;
          return findGroupByWindow((_a = environment.myGroup()) !== null && _a !== void 0 ? _a : environment.my());
      }
      async function create(options) {
          if (isUndefinedOrNull(options)) {
              throw new Error(`options must be defined`);
          }
          if (isUndefinedOrNull(options.groups) || !Array.isArray(options.groups) || options.groups.length === 0) {
              throw new Error(`options.groups must be defined`);
          }
          const { groupIds } = await executor.executeGroup("createGroups", {
              options
          });
          const groups = groupIds.map((groupId) => {
              return waitForGroup(groupId);
          });
          return Promise.all(groups);
      }
      async function close(idOrGroup, options) {
          if (isUndefinedOrNull(idOrGroup)) {
              throw new Error(`group must be defined`);
          }
          let groupId = "";
          if (typeof idOrGroup === "string") {
              groupId = idOrGroup;
          }
          else {
              groupId = idOrGroup.id;
          }
          if (isUndefinedOrNull(options)) {
              throw new Error(`options must be defined`);
          }
          await executor.executeGroup("closeGroup", {
              groupId,
              options
          });
      }
      function list(success) {
          const result = Object.keys(_groups).map((groupId) => {
              if (_groups[groupId]) {
                  return _groups[groupId].groupAPI;
              }
          });
          if (typeof success === "function") {
              success(result);
          }
          return result;
      }
      function findGroupByWindow(winId, success, error) {
          let windowId;
          if (typeof winId === "string") {
              windowId = winId;
          }
          else if (!isUndefinedOrNull(winId)) {
              windowId = winId.id;
          }
          const result = Object.values(_groups).find((groupObj) => {
              const group = groupObj.groupAPI;
              const wins = group.windows.filter((w) => w.id === windowId);
              return wins.length;
          });
          if (result) {
              if (typeof success === "function") {
                  success(result.groupAPI);
              }
              return result.groupAPI;
          }
          else if (typeof error === "function") {
              error(`Cannot find the group of the window.`);
          }
      }
      function waitForGroup(groupId) {
          if (!groupId) {
              return Promise.reject(new Error(`groupId must be defined`));
          }
          return new Promise((res, rej) => {
              const groupWrapper = _groups[groupId];
              if (groupWrapper) {
                  res(groupWrapper.groupAPI);
              }
              else {
                  const un = onGroupAdded((group) => {
                      if (group.id === groupId) {
                          un();
                          res(group);
                      }
                  });
              }
          });
      }
      function getMyGroup() {
          var _a;
          return waitForGroup((_a = environment.myGroup()) !== null && _a !== void 0 ? _a : environment.my());
      }
      async function resume(groupId, activate) {
          validateGroupIdArg(groupId);
          if (!isUndefinedOrNull(activate) && !isBoolean(activate)) {
              throw new Error("Activate flag must be a boolean!");
          }
          activate = !isUndefinedOrNull(activate) ? activate : true;
          await executor.executeGroup("resumeGroup", {
              groupId,
              options: { activate }
          });
      }
      async function hibernate(groupId) {
          validateGroupIdArg(groupId);
          await executor.executeGroup("hibernateGroup", {
              groupId
          });
          return groupId;
      }
      function onGroupAdded(callback) {
          return _registry.add("group-added", callback);
      }
      function onGroupRemoved(callback) {
          return _registry.add("group-removed", callback);
      }
      function onWindowMoved(callback) {
          return _registry.add("window-moved", callback);
      }
      function onHibernated(callback) {
          if (!callback) {
              throw new Error("Callback argument is required");
          }
          if (callback && typeof callback !== "function") {
              throw new Error("Callback argument must be a function");
          }
          return _registry.add("group-hibernated", callback);
      }
      function onResumed(callback) {
          if (!callback) {
              throw new Error("Callback argument is required");
          }
          if (callback && typeof callback !== "function") {
              throw new Error("Callback argument must be a function");
          }
          return _registry.add("group-resumed", callback);
      }
      function createOrGet(groupId) {
          if (!_groups.hasOwnProperty(groupId)) {
              const createdGroupWrapper = groupFactory(groupId, environment.executor);
              _groups[groupId] = createdGroupWrapper;
              const group = createdGroupWrapper.groupAPI;
              _registry.execute("group-added", group);
              return createdGroupWrapper;
          }
          else {
              return _groups[groupId];
          }
      }
      function deleteIfEmpty(groupWrapper) {
          const group = groupWrapper.groupAPI;
          if (group.windows.length === 0) {
              delete _groups[group.id];
              executor.clearCallbacks(group.id);
              _registry.execute("group-removed", group);
          }
      }
      function addWindow(groupId, winId) {
          const group = createOrGet(groupId);
          group.groupInternal.addWindow(winId);
          return group;
      }
      function removeWindow(group, win) {
          if (!group) {
              return;
          }
          group.groupInternal.removeWindow(win);
          deleteIfEmpty(group);
      }
      function handleCompositionChanged(state) {
          const groupId = state.groupId;
          const windowId = state.windowId;
          const win = windowStore.get(windowId);
          if (!win) {
              return;
          }
          const currentGroup = findGroupWrapperByWindow(win.API);
          if (isUndefinedOrNull(groupId)) {
              removeWindow(currentGroup, win);
              return;
          }
          if (isUndefinedOrNull(currentGroup) && !isUndefinedOrNull(groupId)) {
              addWindow(groupId, win.API.id);
              return;
          }
          if (currentGroup.groupAPI.id !== groupId) {
              moveWindow(win, currentGroup.groupAPI.id, groupId);
          }
      }
      function moveWindow(win, from, to) {
          const winId = win.API.id;
          const fromGroup = _groups[from];
          removeWindow(fromGroup, win);
          const toGroup = addWindow(to, winId);
          win.Events.handleGroupChanged(toGroup.groupAPI, fromGroup.groupAPI);
          _registry.execute("window-moved", winId, from, to);
      }
      function findGroupWrapperByWindow(winId) {
          let windowId;
          if (typeof winId === "string") {
              windowId = winId;
          }
          else if (!isUndefinedOrNull(winId)) {
              windowId = winId.id;
          }
          return Object.values(_groups).find((groupObj) => {
              const groupInternal = groupObj.groupInternal;
              const wins = groupInternal.windows.filter((id) => id === windowId);
              return wins.length;
          });
      }
      function validateGroupIdArg(groupId) {
          if (!groupId || typeof groupId !== "string") {
              throw new Error("Please provide a valid Group ID as a non-empty string!");
          }
      }
      const groups = {
          get my() {
              return my();
          },
          create,
          close,
          list,
          findGroupByWindow,
          waitForGroup,
          getMyGroup,
          onGroupAdded,
          onGroupRemoved,
          hibernate,
          resume,
          onHibernated,
          onResumed
      };
      const events = { onWindowMoved };
      return {
          groupsAPI: groups,
          groupsEvents: events,
      };
  };

  var WindowsFactory = (agm, logger, appManagerGetter, displayAPIGetter, channelsGetter, gdMajorVersion) => {
      const _registry = CallbackRegistryFactory();
      const _logger = logger;
      let groups;
      let environment;
      windowStore.init(_logger);
      const isReady = new Promise((resolve, reject) => {
          envDetector(agm, _logger, appManagerGetter, displayAPIGetter, channelsGetter, gdMajorVersion)
              .then((env) => {
              environment = env;
              groups = groupsFactory(env);
              jumpListManager.init(env.executor, agm, _logger);
              resolve();
          })
              .catch((e) => {
              const err = `Timed out waiting for connection to Glue42 Enterprise: Error: ${e.message}`;
              _logger.error(err, e);
              reject(new Error(err));
          });
      });
      function ready() {
          return isReady;
      }
      function my() {
          const myWindow = windowStore.getIfReady(environment.my());
          return myWindow ? myWindow.API : undefined;
      }
      function open(name, url, options, success, error) {
          return Utils.callbackifyPromise(() => {
              if (isNullOrWhiteSpace(name)) {
                  throw new Error("The window name is missing.");
              }
              if (isNullOrWhiteSpace(url)) {
                  throw new Error("The window URL is missing.");
              }
              if (!isUndefinedOrNull(options)) {
                  const optionsAsAny = options;
                  for (const prop of ["minHeight", "maxHeight", "minWidth", "maxWidth", "width", "height", "top", "left"]) {
                      if (prop in optionsAsAny) {
                          const value = optionsAsAny[prop];
                          if (isUndefinedOrNull(value)) {
                              delete optionsAsAny[prop];
                              continue;
                          }
                          if (!isNumber(value)) {
                              const errMessage = `${prop} must be a number`;
                              throw new Error(errMessage);
                          }
                          if (optionsAsAny[prop] === "width" || optionsAsAny[prop] === "height") {
                              if (value <= 0) {
                                  const errMessage = `${prop} must be a positive number`;
                                  throw new Error(errMessage);
                              }
                          }
                      }
                  }
              }
              return environment.open(name, url, options);
          }, success, error);
      }
      function find(name, success, error) {
          const windows = windowStore.list;
          const windowsForListing = Object.keys(windows).reduce((memo, winId) => {
              var _a;
              const window = windows[winId];
              if (((_a = window === null || window === void 0 ? void 0 : window.API) === null || _a === void 0 ? void 0 : _a.name) === name) {
                  memo.push(window.API);
              }
              return memo;
          }, []);
          const win = windowsForListing[0];
          if (win) {
              if (typeof success === "function") {
                  success(windowsForListing[0]);
              }
              return windowsForListing[0];
          }
          else {
              if (typeof error === "function") {
                  error("There is no window with name:" + name);
              }
          }
      }
      function findById(id, success, error) {
          const windows = windowStore.list;
          const windowsForListing = Object.keys(windows).reduce((memo, winId) => {
              const window = windows[winId];
              if (typeof window !== "undefined" && window.API.id === id) {
                  memo.push(window.API);
              }
              return memo;
          }, []);
          const win = windowsForListing[0];
          if (win) {
              if (typeof success === "function") {
                  success(windowsForListing[0]);
              }
              return windowsForListing[0];
          }
          else {
              if (typeof error === "function") {
                  error("There is no window with such id:" + id);
              }
          }
      }
      function list(success) {
          const windows = windowStore.list;
          const windowsForListing = Object.keys(windows)
              .map((k) => {
              return windows[k].API;
          });
          if (typeof success !== "function") {
              return windowsForListing;
          }
          success(windowsForListing);
      }
      function configure(options) {
          const win = my();
          const winId = win ? win.id : "";
          return executor.configure(winId, options);
      }
      function autoArrange(displayId) {
          return executor.autoArrange(displayId);
      }
      function windowAdded(callback) {
          return _registry.add("window-added", callback);
      }
      function windowRemoved(callback) {
          return _registry.add("window-removed", callback);
      }
      function tabAttached(callback) {
          let unsubFunc;
          let unsubscribed = false;
          isReady.then(() => {
              if (unsubscribed) {
                  return;
              }
              unsubFunc = environment.tabAttached(callback);
          });
          return () => {
              unsubscribed = true;
              if (unsubFunc) {
                  unsubFunc();
              }
          };
      }
      function tabDetached(callback) {
          let unsubFunc;
          let unsubscribed = false;
          isReady.then(() => {
              if (unsubscribed) {
                  return;
              }
              unsubFunc = environment.tabDetached(callback);
          });
          return () => {
              unsubscribed = true;
              if (unsubFunc) {
                  unsubFunc();
              }
          };
      }
      function onWindowFrameColorChanged(callback) {
          let unsubFunc;
          let unsubscribed = false;
          isReady.then(() => {
              if (unsubscribed) {
                  return;
              }
              unsubFunc = environment.onWindowFrameColorChanged(callback);
          });
          return () => {
              unsubscribed = true;
              if (unsubFunc) {
                  unsubFunc();
              }
          };
      }
      function onWindowGotFocus(callback) {
          let unsubFunc;
          let unsubscribed = false;
          isReady.then(() => {
              if (unsubscribed) {
                  return;
              }
              unsubFunc = environment.onWindowGotFocus(callback);
          });
          return () => {
              unsubscribed = true;
              if (unsubFunc) {
                  unsubFunc();
              }
          };
      }
      function onWindowLostFocus(callback) {
          let unsubFunc;
          let unsubscribed = false;
          isReady.then(() => {
              if (unsubscribed) {
                  return;
              }
              unsubFunc = environment.onWindowLostFocus(callback);
          });
          return () => {
              unsubscribed = true;
              if (unsubFunc) {
                  unsubFunc();
              }
          };
      }
      function onArrangementChanged(callback) {
          return environment.onWindowsAutoArrangeChanged(callback);
      }
      function onEvent(callback) {
          let unsubFunc;
          let unsubscribed = false;
          isReady.then(() => {
              if (unsubscribed) {
                  return;
              }
              unsubFunc = environment.onEvent(callback);
          });
          return () => {
              unsubscribed = true;
              if (unsubFunc) {
                  unsubFunc();
              }
          };
      }
      function createFlydown(targetId, config) {
          return environment.createFlydown(targetId, config);
      }
      function showPopup(targetId, config) {
          return environment.showPopup(targetId, config);
      }
      function handleWindowAdded(w) {
          _registry.execute("window-added", w.API);
      }
      function handleWindowRemoved(w) {
          _registry.execute("window-removed", w.API);
      }
      windowStore.onReadyWindow(handleWindowAdded);
      windowStore.onRemoved(handleWindowRemoved);
      return {
          my,
          open,
          find,
          findById,
          list,
          ready,
          onWindowAdded: windowAdded,
          windowAdded,
          onWindowRemoved: windowRemoved,
          windowRemoved,
          onTabAttached: tabAttached,
          onTabDetached: tabDetached,
          onWindowFrameColorChanged,
          onArrangementChanged,
          get groups() {
              return groups.groupsAPI;
          },
          onWindowGotFocus,
          onWindowLostFocus,
          onEvent,
          createFlydown,
          showPopup,
          configure,
          autoArrange
      };
  };

  class LayoutStore {
      constructor() {
          this.layouts = [];
      }
      removeWhere(condition) {
          this.layouts = this.layouts.filter(condition);
      }
      removeAll() {
          this.layouts = [];
      }
      add(item) {
          this.layouts.push(item);
      }
      get all() {
          return this.layouts;
      }
      where(condition) {
          return this.layouts.filter(condition);
      }
      first(condition) {
          return this.where(condition)[0];
      }
  }
  var store = new LayoutStore();

  const SaveContextMethodName = "T42.HC.GetSaveContext";
  class ContextProvider {
      constructor(config, activitiesGetter, callbacks, logger) {
          this.config = config;
          this.activitiesGetter = activitiesGetter;
          this.callbacks = callbacks;
          this.logger = logger;
          this.interop = config.agm;
          this.registerRequestMethods();
      }
      onSaveRequested(callback) {
          return this.callbacks.add("saveRequested", callback);
      }
      isActivityOwner() {
          if (typeof htmlContainer !== "undefined") {
              const context = htmlContainer.getContext();
              return context && context._t42 && context._t42.activityIsOwner;
          }
          const activities = this.activitiesGetter();
          if (!activities) {
              return false;
          }
          if (!activities.inActivity) {
              return false;
          }
          const myWindow = activities.my.window;
          const myActivity = activities.my.activity;
          if (!myActivity && !myWindow) {
              return false;
          }
          return myActivity.owner.id === myWindow.id;
      }
      registerRequestMethods() {
          this.interop.register(SaveContextMethodName, (args) => {
              const usersCbs = this.callbacks.execute("saveRequested", args);
              if ((usersCbs === null || usersCbs === void 0 ? void 0 : usersCbs.length) > 1) {
                  this.logger.warn(`Multiple subscriptions for "glue.layouts.onSaveRequested" - only the first one will be used`);
              }
              const requestResult = usersCbs[0];
              const autoSaveWindowContext = this.config.autoSaveWindowContext;
              if (typeof autoSaveWindowContext === "boolean" && autoSaveWindowContext) {
                  return { autoSaveWindowContext };
              }
              else if (Array.isArray(autoSaveWindowContext) && autoSaveWindowContext.length > 0) {
                  return { autoSaveWindowContext };
              }
              const result = { windowContext: requestResult === null || requestResult === void 0 ? void 0 : requestResult.windowContext, activityContext: undefined };
              if (this.isActivityOwner()) {
                  result.activityContext = requestResult === null || requestResult === void 0 ? void 0 : requestResult.activityContext;
              }
              return result;
          });
      }
  }

  function transformACSLayout(something) {
      if (!something) {
          return something;
      }
      if (Array.isArray(something)) {
          return something.map((item) => {
              return transformACSLayout(item);
          });
      }
      if (typeof something === "string" || typeof something === "number" || typeof something === "boolean") {
          return something;
      }
      const initial = {};
      return Object.keys(something).reduce((accumulator, current) => {
          var _a;
          const value = something[current];
          const convertedValue = transformACSLayout(value);
          let key = current;
          if (((_a = current[0]) === null || _a === void 0 ? void 0 : _a.toLowerCase()) !== current[0]) {
              key = current[0].toLowerCase() + current.substr(1);
          }
          accumulator[key] = convertedValue;
          return accumulator;
      }, initial);
  }

  class LayoutImpl {
      constructor(data) {
          this.name = data.name;
          this.type = data.type;
          this.components = data.components;
          this.context = data.context;
          this.metadata = data.metadata;
          this.version = data.version;
          this.displays = data.displays;
      }
  }

  var main = {};

  var application = {};

  /**
   * This file was automatically generated by json-schema-to-typescript.
   * DO NOT MODIFY IT BY HAND. Instead, modify the source JSONSchema file,
   * and run json-schema-to-typescript to regenerate this file.
   */
  Object.defineProperty(application, "__esModule", { value: true });

  var system = {};

  /**
   * This file was automatically generated by json-schema-to-typescript.
   * DO NOT MODIFY IT BY HAND. Instead, modify the source JSONSchema file,
   * and run json-schema-to-typescript to regenerate this file.
   */
  Object.defineProperty(system, "__esModule", { value: true });

  var layout = {};

  Object.defineProperty(layout, "__esModule", { value: true });
  layout.SwimlaneItemType = layout.LayoutType = void 0;
  var LayoutType;
  (function (LayoutType) {
      LayoutType["Global"] = "Global";
      LayoutType["Activity"] = "Activity";
      LayoutType["ApplicationDefault"] = "ApplicationDefault";
      LayoutType["Swimlane"] = "Swimlane";
      LayoutType["Workspaces"] = "Workspace";
  })(LayoutType || (layout.LayoutType = LayoutType = {}));
  var SwimlaneItemType;
  (function (SwimlaneItemType) {
      SwimlaneItemType["Tab"] = "tab";
      SwimlaneItemType["Window"] = "window";
      SwimlaneItemType["Canvas"] = "canvas";
  })(SwimlaneItemType || (layout.SwimlaneItemType = SwimlaneItemType = {}));

  var swTheme = {};

  /**
   * This file was automatically generated by json-schema-to-typescript.
   * DO NOT MODIFY IT BY HAND. Instead, modify the source JSONSchema file,
   * and run json-schema-to-typescript to regenerate this file.
   */
  Object.defineProperty(swTheme, "__esModule", { value: true });

  var swConfiguration = {};

  /**
   * This file was automatically generated by json-schema-to-typescript.
   * DO NOT MODIFY IT BY HAND. Instead, modify the source JSONSchema file,
   * and run json-schema-to-typescript to regenerate this file.
   */
  Object.defineProperty(swConfiguration, "__esModule", { value: true });

  (function (exports) {
  	var __createBinding = (commonjsGlobal && commonjsGlobal.__createBinding) || (Object.create ? (function(o, m, k, k2) {
  	    if (k2 === undefined) k2 = k;
  	    var desc = Object.getOwnPropertyDescriptor(m, k);
  	    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
  	      desc = { enumerable: true, get: function() { return m[k]; } };
  	    }
  	    Object.defineProperty(o, k2, desc);
  	}) : (function(o, m, k, k2) {
  	    if (k2 === undefined) k2 = k;
  	    o[k2] = m[k];
  	}));
  	var __exportStar = (commonjsGlobal && commonjsGlobal.__exportStar) || function(m, exports) {
  	    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
  	};
  	Object.defineProperty(exports, "__esModule", { value: true });
  	// export { SchemaValidator } from "./validator";
  	// export { FileProvider } from "./fileProvider";
  	// export { SchemaProvider } from "./provider";
  	__exportStar(application, exports);
  	__exportStar(system, exports);
  	__exportStar(layout, exports);
  	__exportStar(swTheme, exports);
  	__exportStar(swConfiguration, exports);
  	
  } (main));

  const LayoutsCommandMethod = "T42.ACS.Command";
  class LayoutsAPIImpl {
      constructor(config, stream, callbacks, logger) {
          this.config = config;
          this.stream = stream;
          this.callbacks = callbacks;
          this.isRegisterMethodForLayoutModified = false;
          this.appManager = config.appManager;
          this.provider = new ContextProvider(config, config.activityGetter, callbacks, logger);
          stream.subscribe();
      }
      async setDefaultGlobal(name) {
          const methodName = "SelectDefaultLayout";
          await this.invokeMethodCore(methodName, { name });
          return;
      }
      async clearDefaultGlobal() {
          const methodName = "DeselectDefaultLayout";
          await this.invokeMethodCore(methodName);
          return;
      }
      async getDefaultGlobal() {
          const methodName = "GetDefaultLayout";
          const result = await this.invokeMethodCore(methodName);
          const layout = result.returned;
          if (layout === null || layout === undefined || (typeof layout === 'object' && Object.keys(layout).length === 0)) {
              return undefined;
          }
          return objectClone(this.isSlimMode() ? layout : this.list().find((l) => l.name === layout.name && l.type === layout.type));
      }
      ready() {
          if (this.config.mode === "fullWaitSnapshot") {
              return this.stream.gotSnapshot;
          }
          return this.stream.ready;
      }
      save(layout) {
          return new Promise((resolve, reject) => {
              var _a, _b;
              this.verifyNotSlimMode();
              if (isUndefinedOrNull(layout)) {
                  return reject(new Error("layout is required"));
              }
              if (isNullOrWhiteSpace(layout.name)) {
                  return reject(new Error("layout.name argument is required"));
              }
              if (isNullOrWhiteSpace(layout.type)) {
                  layout.type = "Global";
              }
              if (!isNullOrWhiteSpace(layout.activityId)) {
                  layout.type = "Activity";
              }
              const layoutObject = {
                  name: layout.name,
                  type: layout.type,
                  context: (_a = layout.context) !== null && _a !== void 0 ? _a : {},
                  metadata: (_b = layout.metadata) !== null && _b !== void 0 ? _b : {},
                  options: {},
              };
              if (layout.type === "Activity") {
                  let actId = layout.activityId;
                  if (!actId) {
                      if (!this.appManager.myInstance.inActivity) {
                          return reject(new Error("Current application is not in activity. Cannot save activity layout for it."));
                      }
                      actId = this.appManager.myInstance.activityId;
                  }
                  layoutObject.activityId = actId;
              }
              else if (layout.type === "Global") {
                  if (Array.isArray(layout.ignoreInstances)) {
                      layoutObject.options.ignoreInstances = layout.ignoreInstances;
                  }
                  if (Array.isArray(layout.instances)) {
                      layoutObject.options.instances = layout.instances;
                  }
                  if (typeof layout.setAsCurrent === "boolean") {
                      layoutObject.options.setAsCurrent = layout.setAsCurrent;
                  }
              }
              else {
                  return reject(new Error(`layout type ${layout.type} is not supported`));
              }
              this.invokeMethodAndTrack("SaveLayout", layoutObject, resolve, reject);
          });
      }
      restore(options) {
          return new Promise((resolve, reject) => {
              var _a, _b, _c;
              this.verifyNotSlimMode();
              if (isUndefinedOrNull(options)) {
                  return reject(new Error("options argument is required"));
              }
              if (isNullOrWhiteSpace(options.name)) {
                  return reject(new Error("options.name argument is required"));
              }
              if (isNullOrWhiteSpace(options.type)) {
                  options.type = "Global";
              }
              if (!isNullOrWhiteSpace(options.activityIdToJoin)) {
                  options.type = "Activity";
              }
              if (options.type === "Activity") {
                  if (isUndefinedOrNull(options.setActivityContext)) {
                      options.setActivityContext = true;
                  }
                  if (typeof options.setActivityContext !== "boolean") {
                      return reject(new Error("`setActivityContext` must hold a boolean value."));
                  }
                  options.activityIdToJoin = (_a = options.activityIdToJoin) !== null && _a !== void 0 ? _a : this.appManager.myInstance.activityId;
              }
              if (!isUndefinedOrNull(options.closeRunningInstance)) {
                  options.closeRunningInstances = options.closeRunningInstance;
              }
              if (isUndefinedOrNull(options.closeRunningInstances)) {
                  options.closeRunningInstances = true;
              }
              if (!isBoolean(options.closeRunningInstances)) {
                  return reject(new Error("`closeRunningInstances` must hold a boolean value."));
              }
              if (isUndefinedOrNull(options.closeMe)) {
                  options.closeMe = options.closeRunningInstances;
              }
              if (!isBoolean(options.closeMe)) {
                  return reject(new Error("`closeMe` must hold a boolean value."));
              }
              if (!isUndefinedOrNull(options.context) && !isObject(options.context)) {
                  return reject(new Error("`context` must hold an object value."));
              }
              if (!isUndefinedOrNull(options.timeout) && typeof options.timeout !== "number") {
                  return reject(new Error("`timeout` must hold an number value."));
              }
              options.context = (_b = options.context) !== null && _b !== void 0 ? _b : {};
              const restoreOptions = {
                  activityToJoin: options.activityIdToJoin,
                  setActivityContext: options.setActivityContext,
                  ignoreActivityWindowTypes: options.ignoreActivityWindowTypes,
                  reuseExistingWindows: options.reuseWindows,
                  closeRunningInstances: options.closeRunningInstances,
                  excludeFromClosing: options.closeMe ? [] : [(_c = this.appManager.myInstance) === null || _c === void 0 ? void 0 : _c.id]
              };
              const arg = {
                  type: options.type,
                  name: options.name,
                  context: options.context,
                  options: restoreOptions
              };
              if (options.timeout) {
                  arg.timeout = options.timeout;
              }
              this.invokeMethodAndTrack("RestoreLayout", arg, resolve, reject, true);
          });
      }
      reset(options) {
          return new Promise((resolve, reject) => {
              this.verifyNotSlimMode();
              if (typeof options !== "object") {
                  return reject(new Error("options argument is required"));
              }
              if (isNullOrWhiteSpace(options.layoutId)) {
                  return reject(new Error("options.layoutId argument is required"));
              }
              const msg = {
                  ...options
              };
              this.invokeMethodAndTrack("ResetLayout", msg, resolve, reject, true);
          });
      }
      remove(type, name) {
          return new Promise((resolve, reject) => {
              this.verifyNotSlimMode();
              if (!name) {
                  return reject(new Error("name argument is required"));
              }
              if (!type) {
                  return reject(new Error("type argument is required"));
              }
              const msg = {
                  type,
                  name,
              };
              this.invokeMethodAndTrack("RemoveLayout", msg, resolve, reject);
          });
      }
      list() {
          this.verifyNotSlimMode();
          return objectClone(store.all);
      }
      import(layouts, mode) {
          return new Promise((resolve, reject) => {
              this.verifyNotSlimMode();
              if (!isUndefinedOrNull(mode)) {
                  if (mode !== "merge" && mode !== "replace") {
                      return reject(new Error(`${mode} is not supported - only "merge" and "replace"`));
                  }
              }
              if (!Array.isArray(layouts)) {
                  return reject(new Error("layouts arguments is not an array"));
              }
              const msg = {
                  mode: mode || "replace",
                  layouts
              };
              this.invokeMethodAndTrack("ImportLayouts", msg, resolve, reject, true);
          });
      }
      export(layoutType) {
          return new Promise((resolve, reject) => {
              var _a;
              if (!isUndefinedOrNull(layoutType) && !((_a = Object.values(main.LayoutType)) === null || _a === void 0 ? void 0 : _a.includes(layoutType))) {
                  return reject(new Error(`${layoutType} is not a supported Layout Type`));
              }
              const handleResult = (result) => {
                  let layouts = this.getObjectValues(result.Layouts).map((t) => new LayoutImpl(transformACSLayout(t)));
                  if (layoutType) {
                      layouts = layouts.filter((l) => l.type === layoutType);
                  }
                  resolve(layouts);
              };
              this.invokeMethodAndTrack("ExportLayouts", {}, handleResult, reject, true);
          });
      }
      rename(layout, newName) {
          return new Promise((resolve, reject) => {
              this.verifyNotSlimMode();
              if (!layout) {
                  return reject(new Error("layout argument is required"));
              }
              if (!layout.name) {
                  return reject(new Error("name argument is required"));
              }
              if (!layout.type) {
                  return reject(new Error("type argument is required"));
              }
              const msg = { type: layout.type, oldName: layout.name, newName };
              this.invokeMethodAndTrack("RenameLayout", msg, resolve, reject);
          });
      }
      updateMetadata(layout) {
          return new Promise((resolve, reject) => {
              if (!layout) {
                  return reject(new Error("layout argument is required"));
              }
              if (!layout.name) {
                  return reject(new Error("name argument is required"));
              }
              if (!layout.type) {
                  return reject(new Error("type argument is required"));
              }
              if (!layout.metadata) {
                  return reject(new Error("metadata argument is required"));
              }
              const layoutObject = {
                  name: layout.name,
                  type: layout.type,
                  metadata: layout.metadata
              };
              this.invokeMethodAndTrack("UpdateMetadata", layoutObject, resolve, reject, true);
          });
      }
      hibernate(name, options) {
          return new Promise((resolve, reject) => {
              if (!name) {
                  return reject(new Error("name cannot be empty"));
              }
              options = options || {};
              const request = {
                  name,
                  type: "Global",
                  context: options.context || {},
                  metadata: options.metadata || {},
              };
              this.invokeMethodAndTrack("HibernateLayout", request, resolve, reject, true);
          });
      }
      resume(name, context, options) {
          return new Promise((resolve, reject) => {
              if (!name) {
                  return reject(new Error("name cannot be empty"));
              }
              const request = {
                  name,
                  type: "Global",
                  context,
                  ...options
              };
              this.invokeMethodAndTrack("ResumeLayout", request, resolve, reject, true);
          });
      }
      async getCurrentLayout() {
          const methodName = "GetCurrentLayout";
          const result = await this.invokeMethodCore(methodName);
          let layout = result.returned.layout;
          if (!layout) {
              return undefined;
          }
          if (!this.isSlimMode()) {
              layout = this.list().find((l) => l.name === layout.name && l.type === layout.type);
          }
          return objectClone(layout);
      }
      getRestoredLayoutsInfo() {
          return new Promise((resolve, reject) => {
              const methodName = "GetRestoredLayoutsInfo";
              this.invokeMethodCore(methodName)
                  .then((result) => {
                  const restoredLayouts = result.returned;
                  resolve(restoredLayouts);
              })
                  .catch(reject);
          });
      }
      onAdded(callback) {
          const result = this.callbacks.add("added", callback);
          if (store.all.length > 0) {
              store.all.forEach((layout) => {
                  try {
                      callback(layout);
                  }
                  catch (err) { }
              });
          }
          return result;
      }
      onRemoved(callback) {
          return this.callbacks.add("removed", callback);
      }
      onChanged(callback) {
          return this.callbacks.add("changed", callback);
      }
      onRestored(callback) {
          return this.callbacks.add("restored", callback);
      }
      onRenamed(callback) {
          return this.callbacks.add("renamed", callback);
      }
      onEvent(callback) {
          return this.stream.onEvent(callback);
      }
      onSaveRequested(callback) {
          return this.provider.onSaveRequested(callback);
      }
      onLayoutModified(callback) {
          if (this.isRegisterMethodForLayoutModified === false) {
              this.isRegisterMethodForLayoutModified = true;
              this.registerMethodForLayoutModified();
          }
          return this.callbacks.add("layout-modified", callback);
      }
      updateAppContextInCurrent(context) {
          return new Promise((resolve, reject) => {
              if (context && typeof context !== "object") {
                  return reject(new Error("Context must be an object"));
              }
              context = context !== null && context !== void 0 ? context : {};
              const request = {
                  context
              };
              this.invokeMethodAndTrack("UpdateLayoutComponentContext", request, resolve, reject, true);
          });
      }
      updateDefaultContext(context) {
          return new Promise((resolve, reject) => {
              if (context && typeof context !== "object") {
                  return reject(new Error("Context must be an object"));
              }
              context = context !== null && context !== void 0 ? context : {};
              const request = {
                  context
              };
              this.invokeMethodAndTrack("UpdateDefaultContext", request, resolve, reject, true);
          });
      }
      async get(name, type) {
          const matching = this.list().find((l) => l.name === name && l.type === type);
          if (!matching) {
              throw new Error(`cannot find layout with name=${name} and type=${type}`);
          }
          return objectClone(matching);
      }
      async getAll(type) {
          var _a;
          if (!isUndefinedOrNull(type) && !((_a = Object.values(main.LayoutType)) === null || _a === void 0 ? void 0 : _a.includes(type))) {
              throw new Error((`${type} is not a supported Layout Type`));
          }
          const matching = this.list().filter((l) => type === l.type);
          return objectClone(matching);
      }
      async forceRefresh() {
          const methodName = "RefreshLayouts";
          await this.invokeMethodCore(methodName);
      }
      isSlimMode() {
          return this.config.mode === "slim";
      }
      verifyNotSlimMode() {
          if (this.isSlimMode()) {
              throw Error("Operation not allowed in slim mode. Run in full mode.");
          }
      }
      async registerMethodForLayoutModified() {
          await this.config.agm.register("T42.ACS.LayoutModified", (args, caller) => {
              this.callbacks.execute("layout-modified", args);
          });
      }
      invokeMethodAndTrack(methodName, args, resolve, reject, skipStreamEvent) {
          let streamEventReceived = skipStreamEvent;
          let agmResult;
          const token = Utils.generateId();
          args.token = token;
          const handleResult = () => {
              if (streamEventReceived && agmResult) {
                  resolve(agmResult);
              }
          };
          const methodResponseTimeoutMs = 120 * 1000;
          if (!skipStreamEvent) {
              this.stream.waitFor(token, methodResponseTimeoutMs)
                  .then(() => {
                  streamEventReceived = true;
                  handleResult();
              })
                  .catch((err) => {
                  reject(err);
              });
          }
          const responseHandler = (result) => {
              if (!result.returned) {
                  return reject(new Error("No result from method " + methodName));
              }
              if (result.returned.status && (result.returned.status !== "Success" && result.returned.status !== "PartialSuccess")) {
                  if (typeof (result.returned) === "string") {
                      return reject(new Error(result.returned));
                  }
                  else if (typeof (result.returned) === "object") {
                      if (result.returned.status && result.returned.failed) {
                          return reject(new Error(`${result.returned.status}: ${JSON.stringify(result.returned.failed)}`));
                      }
                      else {
                          return reject(new Error(result.returned));
                      }
                  }
              }
              agmResult = result.returned;
              handleResult();
          };
          this.invokeMethodCore(methodName, args, "best", { methodResponseTimeoutMs })
              .then(responseHandler)
              .catch((err) => reject(err));
      }
      async invokeMethodCore(methodName, args, target, options) {
          options = options !== null && options !== void 0 ? options : {};
          if (typeof options.methodResponseTimeoutMs === "undefined") {
              options.methodResponseTimeoutMs = INTEROP_METHOD_WAIT_TIMEOUT_MS;
          }
          if (typeof options.waitTimeoutMs === "undefined") {
              options.waitTimeoutMs = INTEROP_METHOD_WAIT_TIMEOUT_MS;
          }
          if (this.isCommandMethodPresent()) {
              return await this.config.agm.invoke(LayoutsCommandMethod, { command: methodName, data: args }, target, options);
          }
          else {
              return await this.config.agm.invoke(`T42.ACS.${methodName}`, args, target, options);
          }
      }
      getObjectValues(obj) {
          if (!obj) {
              return [];
          }
          return Object.keys(obj).map((k) => obj[k]);
      }
      isCommandMethodPresent() {
          return this.config.agm.methods().some((method) => method.name === LayoutsCommandMethod);
      }
  }

  class ACSStream {
      constructor(agm, callbacks) {
          this.agm = agm;
          this.callbacks = callbacks;
          this.StreamName = "T42.ACS.OnLayoutEvent";
          this.ready = new Promise((resolve, reject) => {
              this.resolveReady = resolve;
              this.rejectReady = reject;
          });
          this.gotSnapshot = new Promise((resolve, reject) => {
              this.resolveGotSnapshot = resolve;
              this.rejectGotSnapshot = reject;
          });
      }
      subscribe(noRetry) {
          const transform = (obj) => {
              return this.getObjectValues(obj).map((t) => transformACSLayout(t));
          };
          if (!this.checkForLayoutEventMethod()) {
              if (noRetry) {
                  this.resolveReady();
              }
              setTimeout(() => {
                  this.subscribe(true);
              }, 500);
          }
          else {
              this.agm.subscribe(this.StreamName, { waitTimeoutMs: 10000 })
                  .then((subs) => {
                  subs.onData((args) => {
                      const data = args.data;
                      if (data.IsSnapshot) {
                          this.resolveGotSnapshot();
                      }
                      this.addLayouts(transform(data.OnLayoutAdded), data.IsSnapshot);
                      this.removeLayouts(transform(data.OnLayoutRemoved));
                      this.changeLayouts(transform(data.OnLayoutChanged));
                      this.renameLayouts(transform(data.OnLayoutRenamed));
                      this.restoredLayout(transform(data.OnLayoutRestored));
                      this.callbacks.execute("streamEvent", data);
                  });
                  subs.onFailed((err) => {
                      const msg = `Can not subscribe to "${this.StreamName}" stream - ${JSON.stringify(err)}`;
                      this.rejectReady(msg);
                      this.rejectGotSnapshot(msg);
                  });
                  this.resolveReady();
              })
                  .catch((err) => {
                  const msg = `Error subscribing to "${this.StreamName}" stream - ${JSON.stringify(err)}`;
                  this.rejectReady(msg);
                  this.rejectGotSnapshot(msg);
              });
          }
      }
      onEvent(callback) {
          return this.callbacks.add("streamEvent", callback);
      }
      waitFor(token, timeout) {
          if (!timeout) {
              timeout = 30000;
          }
          return new Promise((resolve, reject) => {
              let done = false;
              const unsubscribe = this.onEvent((streamEvent) => {
                  if (streamEvent.Token === token) {
                      done = true;
                      unsubscribe();
                      resolve();
                  }
              });
              setTimeout(() => {
                  if (!done) {
                      reject("timed out");
                  }
              }, timeout);
          });
      }
      checkForLayoutEventMethod() {
          try {
              return this.agm
                  .methods()
                  .map((m) => m.name)
                  .indexOf(this.StreamName) !== -1;
          }
          catch (e) {
              return false;
          }
      }
      addLayouts(layoutsData, isSnapshot) {
          if (!layoutsData) {
              return;
          }
          const createAndNotifyLayout = (layoutData) => {
              const layout = new LayoutImpl(layoutData);
              store.add(layout);
              this.callbacks.execute("added", layout);
          };
          layoutsData.forEach((layoutData) => {
              if (isSnapshot) {
                  const found = store.first((existingLayout) => this.compareLayouts(existingLayout, layoutData));
                  if (!found) {
                      createAndNotifyLayout(layoutData);
                  }
              }
              else {
                  createAndNotifyLayout(layoutData);
              }
          });
      }
      removeLayouts(removedLayouts) {
          if (!removedLayouts) {
              return;
          }
          removedLayouts.forEach((removedLayout) => {
              store.removeWhere((existingLayout) => !this.compareLayouts(existingLayout, removedLayout));
              this.callbacks.execute("removed", removedLayout);
          });
      }
      changeLayouts(changedLayouts) {
          if (!changedLayouts) {
              return;
          }
          changedLayouts.forEach((changedLayout) => {
              store.removeWhere((existingLayout) => !this.compareLayouts(existingLayout, changedLayout));
              store.add(new LayoutImpl(changedLayout));
              this.callbacks.execute("changed", changedLayout);
          });
      }
      renameLayouts(renamedLayouts) {
          if (!renamedLayouts) {
              return;
          }
          renamedLayouts.forEach((renamedLayout) => {
              const existingLayout = store.first((current) => this.compareLayouts(current, { type: renamedLayout.type, name: renamedLayout.oldName }));
              if (!existingLayout) {
                  throw Error(`received rename event for unknown layout with type ${renamedLayout.type} and name ${renamedLayout.oldName}`);
              }
              existingLayout.name = renamedLayout.newName;
              this.callbacks.execute("renamed", existingLayout);
          });
      }
      compareLayouts(layout1, layout2) {
          return layout1.name === layout2.name && layout1.type === layout2.type;
      }
      getObjectValues(obj) {
          if (!obj) {
              return [];
          }
          return Object.keys(obj).map((k) => obj[k]);
      }
      restoredLayout(restoredLayouts) {
          if (!restoredLayouts) {
              return;
          }
          restoredLayouts.forEach((restoredLayout) => {
              const existingLayout = store.first((current) => this.compareLayouts(current, { type: restoredLayout.type, name: restoredLayout.name }));
              this.callbacks.execute("restored", existingLayout);
          });
      }
  }

  function LayoutsFactory (config) {
      if (!config.agm) {
          throw Error("config.agm is required");
      }
      if (!config.logger) {
          throw Error("config.logger is required");
      }
      config.mode = config.mode || "slim";
      const logger = config.logger;
      const callbacks = CallbackRegistryFactory();
      let acsStream;
      if (config.mode === "full" || "fullWaitSnapshot") {
          acsStream = new ACSStream(config.agm, callbacks);
      }
      return new LayoutsAPIImpl(config, acsStream, callbacks, logger);
  }

  const T42DisplayCommand = "T42.Displays.Command";
  const T42DisplayOnEvent = "T42.Displays.OnEvent";
  class DisplayManager {
      constructor(_agm, _logger) {
          this._agm = _agm;
          this._logger = _logger;
          this._registry = CallbackRegistryFactory();
          this._registered = false;
          this.all = async () => {
              const displays = await this.callGD(DisplayCommand.GetAll, {});
              return displays.map(this.decorateDisplay);
          };
          this.get = async (id) => {
              const display = await this.callGD(DisplayCommand.Get, { id });
              return this.decorateDisplay(display);
          };
          this.getPrimary = async () => {
              const primary = (await this.all()).find((d) => d.isPrimary);
              return primary;
          };
          this.capture = async (options) => {
              const screenshot = await this.callGD(DisplayCommand.Capture, { ...options });
              return screenshot;
          };
          this.captureAll = async (options) => {
              const screenshots = await this.callGD(DisplayCommand.CaptureAll, { ...options });
              return screenshots;
          };
          this.getMousePosition = async () => {
              const point = await this.callGD(DisplayCommand.GetMousePosition);
              return point;
          };
          this.callGD = async (command, options) => {
              const invocationResult = await this._agm.invoke(T42DisplayCommand, { options: { ...options }, command }, "best", {
                  waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
                  methodResponseTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS
              });
              return invocationResult.returned.data;
          };
          this.decorateDisplay = (original) => {
              const decoratedDisplay = {
                  ...original,
                  capture: (size) => this.capture({ id: original.id, size })
              };
              const workAreaAsAny = decoratedDisplay.workArea;
              workAreaAsAny.x = workAreaAsAny.left;
              workAreaAsAny.y = decoratedDisplay.workArea.top;
              return decoratedDisplay;
          };
      }
      getByWindowId(id) {
          const current = this.callGD(DisplayCommand.GetByWindowId, { id });
          return current;
      }
      onDisplayChanged(cb) {
          this.register();
          return this._registry.add("on-display-changed", cb);
      }
      register() {
          if (this._registered) {
              return;
          }
          this._registered = true;
          this._agm.register(T42DisplayOnEvent, (args, caller) => {
              const event = args.event;
              const data = args.data;
              switch (event) {
                  case "display-changed":
                      this._registry.execute("on-display-changed", data.displays.map(this.decorateDisplay));
                      break;
                  default:
                      this._logger.warn(`unknown event - ${event}`);
                      break;
              }
          });
      }
  }
  var DisplayCommand;
  (function (DisplayCommand) {
      DisplayCommand["Capture"] = "capture";
      DisplayCommand["CaptureAll"] = "captureAll";
      DisplayCommand["GetAll"] = "getAll";
      DisplayCommand["Get"] = "get";
      DisplayCommand["GetByWindowId"] = "getByWindowId";
      DisplayCommand["GetMousePosition"] = "getMousePosition";
  })(DisplayCommand || (DisplayCommand = {}));

  class SingleChannelID {
      constructor(channel) {
          this.channel = channel;
      }
      get isJoinedToAnyChannel() {
          return !!this.channel;
      }
      isOnChannel(channel) {
          return this.channel === channel;
      }
      leaveChannel(channel) {
          if (channel === undefined || this.channel === channel) {
              this.channel = undefined;
          }
      }
      joinChannel(channel) {
          this.channel = channel;
      }
      all() {
          if (this.channel) {
              return [this.channel];
          }
          return [];
      }
      toString() {
          return this.channel;
      }
      equals(other) {
          if (other instanceof SingleChannelID) {
              return this.channel === other.channel;
          }
          return false;
      }
  }
  class MultiChannelId {
      constructor(channels) {
          this.ChannelDelimiter = "+++";
          if (!channels) {
              this.channels = [];
          }
          else if (typeof channels === "string") {
              this.channels = channels === null || channels === void 0 ? void 0 : channels.split(this.ChannelDelimiter).filter(Boolean);
          }
          else {
              this.channels = (channels !== null && channels !== void 0 ? channels : []).filter(Boolean);
          }
      }
      get isJoinedToAnyChannel() {
          return this.channels.length > 0;
      }
      isOnChannel(channel) {
          return this.channels.includes(channel);
      }
      joinChannel(channel) {
          const newChannels = new MultiChannelId(channel);
          newChannels.all().forEach((newChannel) => {
              if (!this.channels.includes(newChannel)) {
                  this.channels.push(newChannel);
              }
          });
      }
      leaveChannel(channel) {
          const channelsToLeave = new MultiChannelId(channel !== null && channel !== void 0 ? channel : this.channels);
          channelsToLeave.all().forEach((c) => {
              this.channels = this.channels.filter((ch) => ch !== c);
          });
      }
      all() {
          return this.channels;
      }
      toString() {
          if (this.channels.length === 0) {
              return undefined;
          }
          return this.channels.join(this.ChannelDelimiter);
      }
      equals(other) {
          if (other instanceof MultiChannelId) {
              return this.channels.length === other.channels.length &&
                  this.channels.every((c, i) => c === other.channels[i]);
          }
          return false;
      }
  }

  let interop;
  let myInstanceId;
  let logger;
  const T42_ANNOUNCE_METHOD_NAME = "T42.Channels.Announce";
  const T42_COMMAND_METHOD_NAME = "T42.Channels.Command";
  async function setupInterop(interopLib, channels, loggerAPI) {
      var _a, _b;
      logger = loggerAPI;
      interop = interopLib;
      if (typeof window !== "undefined") {
          if (window.glue42gd) {
              myInstanceId = window.glue42gd.windowId;
          }
      }
      if (!myInstanceId) {
          myInstanceId = interopLib.instance.instance;
      }
      await interop.register(T42_COMMAND_METHOD_NAME, (args) => {
          const command = args.command;
          if (!command) {
              throw new Error("missing command argument");
          }
          logger.trace(`received command "${command}" with ${JSON.stringify(args)}`);
          if (command === "join") {
              const id = args.channel;
              if (!id) {
                  throw new Error("missing argument id");
              }
              return channels.joinNoSelectorSwitch(id);
          }
          if (command === "leave") {
              return channels.leaveNoSelectorSwitch();
          }
          if (command === "get") {
              const id = channels.current();
              return { id };
          }
          if (command === "restrictions-changed") {
              const restrictions = args.restrictions;
              const targetWindowId = args.swId;
              channels.handleRestrictionsChanged(restrictions, targetWindowId);
              return;
          }
          if (command === "isFdc3DataWrappingSupported") {
              return { isSupported: true };
          }
          if (command === "join-multi") {
              const channelsToJoin = args.channelsToJoin;
              if (!channelsToJoin) {
                  throw new Error("missing argument channelsToJoin");
              }
              return channels.joinNoSelectorSwitch(new MultiChannelId(channelsToJoin).toString());
          }
          if (command === "leave-multi") {
              const channelsToLeave = args.channelsToLeave;
              return channels.leaveNoSelectorSwitch(new MultiChannelId(channelsToLeave).toString());
          }
          throw new Error(`unknown command ${command}`);
      });
      const result = await interop.invoke(T42_ANNOUNCE_METHOD_NAME, { swId: myInstanceId, instance: interop.instance.instance }, "best", {
          waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
          methodResponseTimeoutMs: INTEROP_METHOD_RESPONSE_TIMEOUT_MS
      });
      if ((_a = result.returned) === null || _a === void 0 ? void 0 : _a.restrictions) {
          channels.handleRestrictionsChanged((_b = result.returned) === null || _b === void 0 ? void 0 : _b.restrictions, myInstanceId);
      }
      return result.returned;
  }
  async function sendLeaveChannel(channel, winId) {
      var _a;
      await invoke("leaveChannel", { channel }, (_a = winId !== null && winId !== void 0 ? winId : winId) !== null && _a !== void 0 ? _a : myInstanceId);
  }
  async function sendSwitchChannelUI(channel, winId) {
      await invoke("switchChannel", { newChannel: channel }, winId !== null && winId !== void 0 ? winId : myInstanceId);
  }
  async function setRestrictions(restrictions) {
      var _a;
      await invoke("restrict", restrictions, (_a = restrictions.windowId) !== null && _a !== void 0 ? _a : myInstanceId);
  }
  async function getRestrictionsByWindow(id) {
      try {
          const result = await invoke("getRestrictions", {}, id !== null && id !== void 0 ? id : myInstanceId);
          return result.returned;
      }
      catch (e) {
      }
  }
  async function setRestrictionsForAllChannels(restrictions) {
      var _a;
      await invoke("restrictAll", restrictions, (_a = restrictions.windowId) !== null && _a !== void 0 ? _a : myInstanceId);
  }
  async function getChannelsInfo(filter) {
      const result = await invoke("getChannelsInfo", { filter });
      return result.returned;
  }
  async function addOrRemoveChannel(command, id, color, label) {
      await invoke(command, { id, color, label });
  }
  async function getChannelInitInfo(config, i) {
      if (typeof config.operationMode !== "boolean" && typeof config.operationMode === "string") {
          validateMode(config.operationMode);
          return { mode: config.operationMode, initialChannel: undefined };
      }
      try {
          const result = await i.invoke(T42_ANNOUNCE_METHOD_NAME, { command: "getChannelsMode" }, "best", {
              waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
              methodResponseTimeoutMs: INTEROP_METHOD_RESPONSE_TIMEOUT_MS,
          });
          const initialChannel = result.returned.initialChannel;
          if (result.returned.mode === "single") {
              return {
                  mode: "single",
                  initialChannel
              };
          }
          else if (result.returned.mode === "multi") {
              return {
                  mode: "multi",
                  initialChannel
              };
          }
          else {
              return {
                  mode: "single",
                  initialChannel
              };
          }
      }
      catch (e) {
          return { mode: "single", initialChannel: undefined };
      }
  }
  function invoke(command, data, swId) {
      const args = { command, data };
      if (swId) {
          args.swId = swId;
      }
      return interop.invoke(T42_ANNOUNCE_METHOD_NAME, args, "best", {
          waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
          methodResponseTimeoutMs: INTEROP_METHOD_RESPONSE_TIMEOUT_MS,
      });
  }
  function validateMode(mode) {
      if (mode !== "single" && mode !== "multi") {
          throw new Error(`Invalid mode: ${mode}`);
      }
  }

  const CONTEXT_PREFIX = "___channel___";
  const LATEST_FDC3_TYPE = "latest_fdc3_type";
  class BaseSharedContextSubscriber {
      constructor(contexts) {
          this.contexts = contexts;
      }
      subscribe(callback) {
          this.callback = callback;
      }
      subscribeFor(name, callback) {
          if (!this.isChannel(name)) {
              return Promise.reject(new Error(`Channel with name: ${name} doesn't exist!`));
          }
          const contextName = this.createContextName(name);
          return this.contexts.subscribe(contextName, (data, _, __, ___, extraData) => {
              callback(data.data, data, extraData === null || extraData === void 0 ? void 0 : extraData.updaterId);
          });
      }
      all() {
          const contextNames = this.contexts.all();
          const channelContextNames = contextNames.filter((contextName) => contextName.startsWith(CONTEXT_PREFIX));
          const channelNames = channelContextNames.map((channelContextName) => channelContextName.substr(CONTEXT_PREFIX.length));
          return channelNames;
      }
      async getContextData(name) {
          if (!this.isChannel(name)) {
              throw new Error(`A channel with name: ${name} doesn't exist!`);
          }
          const contextName = this.createContextName(name);
          const contextData = await this.contexts.get(contextName);
          if (contextData[LATEST_FDC3_TYPE]) {
              return this.getContextWithFdc3Data(contextData);
          }
          else {
              delete contextData[LATEST_FDC3_TYPE];
          }
          return contextData;
      }
      updateChannel(name, data) {
          const contextName = this.createContextName(name);
          return this.contexts.update(contextName, data);
      }
      updateData(name, data) {
          const contextName = this.createContextName(name);
          const fdc3Type = this.getFDC3Type(data);
          if (this.contexts.setPathSupported) {
              const pathValues = Object.keys(data).map((key) => {
                  return {
                      path: `data.` + key,
                      value: data[key]
                  };
              });
              if (fdc3Type) {
                  pathValues.push({ path: LATEST_FDC3_TYPE, value: fdc3Type });
              }
              return this.contexts.setPaths(contextName, pathValues);
          }
          else {
              if (fdc3Type) {
                  data[LATEST_FDC3_TYPE] = fdc3Type;
              }
              return this.contexts.update(contextName, { data });
          }
      }
      setPaths(name, paths) {
          const contextName = this.createContextName(name);
          if (this.contexts.setPathSupported) {
              const pathValues = paths.map((p) => {
                  return {
                      path: `data.` + p.path,
                      value: p.value
                  };
              });
              pathValues.map((p) => {
                  const fdc3Type = this.getFDC3Type(p.value);
                  if (fdc3Type) {
                      pathValues.push({ path: LATEST_FDC3_TYPE, value: fdc3Type });
                  }
              });
              return this.contexts.setPaths(contextName, pathValues);
          }
          else {
              throw new Error("setPaths is not supported!");
          }
      }
      clearContextData(name) {
          const contextName = this.createContextName(name);
          return this.contexts.update(contextName, { data: {}, [LATEST_FDC3_TYPE]: undefined });
      }
      isChannel(name) {
          return this.all().some((channelName) => channelName === name);
      }
      async remove(name) {
          if (!this.isChannel(name)) {
              throw new Error(`A channel with name: ${name} doesn't exist!`);
          }
          const contextName = this.createContextName(name);
          await this.contexts.destroy(contextName);
      }
      createContextName(name) {
          return CONTEXT_PREFIX + name;
      }
      getFDC3Type(data) {
          const fdc3PropsArr = Object.keys(data).filter((key) => key.indexOf("fdc3_") === 0);
          if (fdc3PropsArr.length === 0) {
              return;
          }
          if (fdc3PropsArr.length > 1) {
              throw new Error("FDC3 does not support updating of multiple context keys");
          }
          return fdc3PropsArr[0].split("_").slice(1).join("_");
      }
      getContextWithFdc3Data(channelContext) {
          const { latest_fdc3_type, ...rest } = channelContext;
          const parsedType = latest_fdc3_type.split("&").join(".");
          const fdc3Context = { type: parsedType, ...rest.data[`fdc3_${latest_fdc3_type}`] };
          delete rest.data[`fdc3_${latest_fdc3_type}`];
          const context = {
              name: channelContext.name,
              meta: channelContext.meta,
              data: {
                  ...rest.data,
                  fdc3: fdc3Context
              }
          };
          return context;
      }
  }
  class MultiSharedContextSubscriber extends BaseSharedContextSubscriber {
      constructor() {
          super(...arguments);
          this.currentlySubscribedChannels = [];
          this.unsubscribeMap = {};
      }
      async switchChannel(id) {
          const newChannels = new MultiChannelId(id).all();
          for (const newChannel of newChannels) {
              if (!this.currentlySubscribedChannels.includes(newChannel)) {
                  await this.subscribeToChannel(newChannel);
              }
          }
      }
      async leave(id) {
          const channelsToLeave = new MultiChannelId(id).all();
          for (const newChannel of channelsToLeave) {
              if (this.currentlySubscribedChannels.includes(newChannel)) {
                  this.unsubscribeFromChannel(newChannel);
              }
          }
      }
      async updateData(id, data) {
          const channels = new MultiChannelId(id).all();
          for (const channel of channels) {
              await super.updateData(channel, data);
          }
      }
      async setPaths(id, paths) {
          const channels = new MultiChannelId(id).all();
          for (const channel of channels) {
              await super.setPaths(channel, paths);
          }
      }
      isChannel(name) {
          const channels = new MultiChannelId(name).all();
          return channels.every((channel) => super.isChannel(channel));
      }
      async subscribeToChannel(name) {
          const contextName = this.createContextName(name);
          const usub = await this.contexts.subscribe(contextName, (data, _, __, ___, extraData) => {
              if (this.callback) {
                  this.callback(data.data, data, extraData === null || extraData === void 0 ? void 0 : extraData.updaterId);
              }
          });
          this.currentlySubscribedChannels.push(name);
          this.unsubscribeMap[contextName] = usub;
      }
      async unsubscribeFromChannel(name) {
          const contextName = this.createContextName(name);
          const unsub = this.unsubscribeMap[contextName];
          if (unsub) {
              unsub();
              delete this.unsubscribeMap[contextName];
          }
          this.currentlySubscribedChannels = this.currentlySubscribedChannels.filter((channel) => channel !== name);
      }
  }
  class SharedContextSubscriber extends BaseSharedContextSubscriber {
      async switchChannel(name) {
          this.unsubscribe();
          const contextName = this.createContextName(name);
          this.unsubscribeFunc = await this.contexts.subscribe(contextName, (data, _, __, ___, extraData) => {
              if (this.callback) {
                  this.callback(data.data, data, extraData === null || extraData === void 0 ? void 0 : extraData.updaterId);
              }
          });
      }
      async leave() {
          if (this.callback) {
              this.callback({}, undefined);
          }
          this.unsubscribe();
      }
      unsubscribe() {
          if (this.unsubscribeFunc) {
              this.unsubscribeFunc();
              this.unsubscribeFunc = undefined;
          }
      }
  }

  const validateFdc3Options = (options) => {
      if (typeof options !== "object" || Array.isArray(options)) {
          throw new Error(`Provide options as an object`);
      }
      if (options.contextType && (typeof options.contextType !== "string" || !options.contextType.length)) {
          throw new Error(`Provide options.contextType as a non-empty string`);
      }
  };

  class ChannelsImpl {
      constructor(interop, getWindowsAPI, getAppManagerAPI, logger) {
          this.interop = interop;
          this.getWindowsAPI = getWindowsAPI;
          this.getAppManagerAPI = getAppManagerAPI;
          this.logger = logger;
          this.subsKey = "subs";
          this.changedKey = "changed";
          this.channelsChangedKey = "channelsChanged";
          this.isInitialJoin = true;
          this.registry = CallbackRegistryFactory();
          this.pendingReplays = {};
          this.pendingRestrictionCallbacks = new Map();
      }
      async getMyChannels(options) {
          if (!this.currentChannelID) {
              return Promise.resolve([]);
          }
          if (this.currentChannelID.all().length === 0) {
              return Promise.resolve([]);
          }
          const result = [];
          for (const channel of this.currentChannelID.all()) {
              result.push(await this.get(channel, options));
          }
          return result;
      }
      async init(shared, mode, initial) {
          this.mode = mode;
          this.shared = shared;
          this.shared.subscribe(this.handler.bind(this));
          this.subscribeForChannelRestrictionsChange();
          let initialChannel = initial;
          if (typeof window !== "undefined" && typeof window.glue42gd !== "undefined") {
              initialChannel = window.glue42gd.initialChannel;
          }
          this.currentChannelID = this.getID(initialChannel);
          this.logger.trace(`initialized with mode: "${mode}" and initial channel: "${initialChannel}"`);
          if (this.currentChannelID.isJoinedToAnyChannel) {
              this.logger.trace(`joining initial channel: "${this.currentChannelID.toString()}"`);
              await this.joinNoSelectorSwitch(this.currentChannelID.toString());
          }
      }
      subscribe(callback, options) {
          if (typeof callback !== "function") {
              throw new Error("Please provide the callback as a function!");
          }
          const id = Utils.generateId();
          this.pendingReplays[id] = true;
          const wrappedCallback = (options === null || options === void 0 ? void 0 : options.contextType)
              ? this.getWrappedSubscribeCallbackWithFdc3Type(callback, id, options.contextType)
              : this.getWrappedSubscribeCallback(callback, id);
          if (this.lastUpdate) {
              let lastUpdate = Object.assign({}, this.lastUpdate);
              setTimeout(async () => {
                  if (this.pendingReplays[id]) {
                      if (this.lastUpdate) {
                          lastUpdate = this.lastUpdate;
                      }
                      wrappedCallback(lastUpdate.context.data, lastUpdate.context, lastUpdate.updaterId);
                  }
                  delete this.pendingReplays[id];
              }, 0);
          }
          const unsub = this.registry.add(this.subsKey, wrappedCallback);
          return () => {
              this.pendingReplays[id] = false;
              this.pendingRestrictionCallbacks.delete(id);
              unsub();
          };
      }
      async subscribeFor(name, callback, options) {
          if (typeof name !== "string") {
              throw new Error("Please provide the name as a string!");
          }
          if (typeof callback !== "function") {
              throw new Error("Please provide the callback as a function!");
          }
          const id = Utils.generateId();
          const wrappedCallback = (options === null || options === void 0 ? void 0 : options.contextType)
              ? this.getWrappedSubscribeCallbackWithFdc3Type(callback, id, options.contextType)
              : this.getWrappedSubscribeCallback(callback, id);
          const unsub = await this.shared.subscribeFor(name, wrappedCallback);
          return () => {
              this.pendingRestrictionCallbacks.delete(id);
              unsub();
          };
      }
      async publish(data, options) {
          if (typeof data !== "object") {
              throw new Error("Please provide the data as an object!");
          }
          if (options) {
              this.validatePublishOptions(options);
          }
          if (typeof options === "object") {
              return this.publishWithOptions(data, options);
          }
          const channelName = typeof options === "string" ? options : this.currentChannelID.toString();
          if (!channelName) {
              throw new Error("Not joined to any channel!");
          }
          if (!this.shared.isChannel(channelName)) {
              return Promise.reject(new Error(`A channel with name: ${channelName} doesn't exist!`));
          }
          if (this.mode === "multi") {
              const channelsToPublish = new MultiChannelId(channelName).all();
              const restrictedChannels = [];
              for (const cn of channelsToPublish) {
                  const canPublish = (await this.getRestrictionsByChannel(cn)).write;
                  if (!canPublish) {
                      restrictedChannels.push(cn);
                      continue;
                  }
                  await this.shared.updateData(cn, data);
              }
              if (restrictedChannels.length > 0) {
                  const restrictedChannelsErr = `Unable to publish due to restrictions to the following channels: ${restrictedChannels.join(", ")}`;
                  if (restrictedChannels.length === channelsToPublish.length) {
                      throw new Error(restrictedChannelsErr);
                  }
                  else {
                      this.logger.warn(restrictedChannelsErr);
                  }
              }
          }
          else {
              const canPublish = (await this.getRestrictionsByChannel(channelName)).write;
              if (!canPublish) {
                  throw new Error(`Window does not have permission to write to channel ${channelName}`);
              }
              return this.shared.updateData(channelName, data);
          }
      }
      async setPaths(paths, name) {
          if (name) {
              if (typeof name !== "string") {
                  throw new Error("Please provide the name as a string!");
              }
              if (!this.shared.isChannel(name)) {
                  return Promise.reject(new Error(`A channel with name: ${name} doesn't exist!`));
              }
              if (!(await this.getRestrictionsByChannel(name)).write) {
                  throw new Error(`Window does not have permission to write to channel ${name}`);
              }
              return this.shared.setPaths(name, paths);
          }
          if (!this.currentChannelID) {
              throw new Error("Not joined to any channel!");
          }
          if (!(await this.getRestrictionsByChannel(this.currentChannelID.toString())).write) {
              throw new Error(`Window does not have permission to write to channel ${this.currentChannelID.toString()}`);
          }
          if (!Array.isArray(paths)) {
              throw new Error("Path Values argument is not a valid array");
          }
          paths.forEach((path) => {
              this.validatePathArgs(path);
          });
          return this.shared.setPaths(this.currentChannelID.toString(), paths);
      }
      async setPath(path, name) {
          if (name) {
              if (typeof name !== "string") {
                  throw new Error("Please provide the name as a string!");
              }
              if (!this.shared.isChannel(name)) {
                  return Promise.reject(new Error(`A channel with name: ${name} doesn't exist!`));
              }
              if (!(await this.getRestrictionsByChannel(name)).write) {
                  throw new Error(`Window does not have permission to write to channel ${name}`);
              }
              return this.shared.setPaths(name, [path]);
          }
          if (!this.currentChannelID) {
              throw new Error("Not joined to any channel!");
          }
          if (!(await this.getRestrictionsByChannel(this.currentChannelID.toString())).write) {
              throw new Error(`Window does not have permission to write to channel ${this.currentChannelID.toString()}`);
          }
          this.validatePathArgs(path);
          return this.shared.setPaths(this.currentChannelID.toString(), [path]);
      }
      all() {
          const channelNames = this.shared.all();
          return Promise.resolve(channelNames);
      }
      async list() {
          const channelNames = await this.all();
          const channelContexts = await Promise.all(channelNames.map((channelName) => this.get(channelName)));
          return channelContexts;
      }
      async get(name, options) {
          if (typeof name !== "string") {
              return Promise.reject(new Error("Please provide the channel name as a string!"));
          }
          if (!(options === null || options === void 0 ? void 0 : options.contextType)) {
              return this.shared.getContextData(name);
          }
          validateFdc3Options(options);
          const context = await this.shared.getContextData(name);
          return this.getContextWithFdc3Type(context, options.contextType);
      }
      getMy(options) {
          if (!this.currentChannelID) {
              return Promise.resolve(undefined);
          }
          if (this.currentChannelID.all().length === 0) {
              return Promise.resolve(undefined);
          }
          return this.get(this.currentChannelID.all()[0], options);
      }
      async join(name, windowId) {
          if (windowId !== undefined && windowId !== null) {
              this.validateWindowIdArg(windowId);
              this.logger.trace(`joining channel ${name} for window: ${windowId}`);
              return sendSwitchChannelUI(name, windowId);
          }
          return this.joinCore(name);
      }
      async joinNoSelectorSwitch(channelName) {
          this.logger.trace(`joining channel "${channelName}" from command`);
          return this.joinCore(channelName, false);
      }
      leave(options) {
          this.logger.trace(`leaving channel with options: ${JSON.stringify(options)}`);
          let windowId;
          let channelName;
          if (typeof options === "string") {
              windowId = options;
          }
          else if (typeof options === "object" && !Array.isArray(options) && options !== null && options !== undefined) {
              if (options.windowId) {
                  windowId = options.windowId;
              }
              if (options.channel) {
                  channelName = options.channel;
              }
          }
          if (this.mode === "multi") {
              return this.leaveWhenMulti(channelName, windowId);
          }
          else {
              return this.leaveWhenSingle(channelName, windowId);
          }
      }
      leaveNoSelectorSwitch(channelName) {
          this.logger.trace(`leaving channel "${channelName}" from command`);
          return this.leaveCore(false, channelName);
      }
      current() {
          return this.currentChannelID.toString();
      }
      my() {
          return this.current();
      }
      myChannels() {
          var _a;
          return (_a = this.currentChannelID.all()) !== null && _a !== void 0 ? _a : [];
      }
      onChannelsChanged(callback) {
          if (typeof callback !== "function") {
              throw new Error("Please provide the callback as a function!");
          }
          let timeoutId;
          const current = this.current();
          if (current) {
              timeoutId = setTimeout(() => {
                  callback(this.myChannels());
              }, 0);
          }
          const un = this.registry.add(this.channelsChangedKey, callback);
          return () => {
              un();
              clearTimeout(timeoutId);
          };
      }
      changed(callback) {
          if (typeof callback !== "function") {
              throw new Error("Please provide the callback as a function!");
          }
          const current = this.current();
          if (current) {
              setTimeout(() => {
                  callback(this.current());
              }, 0);
          }
          return this.registry.add(this.changedKey, () => {
              callback(this.current());
          });
      }
      onChanged(callback) {
          return this.changed(callback);
      }
      async add(info) {
          var _a;
          if (typeof info !== "object") {
              throw new Error("Please provide the info as an object!");
          }
          if (typeof info.name === "undefined") {
              throw new Error("info.name is missing!");
          }
          if (typeof info.name !== "string") {
              throw new Error("Please provide the info.name as a string!");
          }
          if (typeof info.meta === "undefined") {
              throw new Error("info.meta is missing!");
          }
          if (typeof info.meta !== "object") {
              throw new Error("Please provide the info.meta as an object!");
          }
          if (typeof info.meta.color === "undefined") {
              throw new Error("info.meta.color is missing!");
          }
          if (typeof info.meta.color !== "string") {
              throw new Error("Please provide the info.meta.color as a string!");
          }
          const context = {
              name: info.name,
              meta: info.meta || {},
              data: info.data || {}
          };
          this.logger.trace(`adding channel: ${info.name}`);
          await addOrRemoveChannel("addChannel", info.name, info.meta.color, (_a = info.meta) === null || _a === void 0 ? void 0 : _a.label);
          await this.shared.updateChannel(info.name, context);
          return context;
      }
      async remove(channel) {
          if (typeof channel !== "string") {
              throw new Error("Please provide the channel name as a string!");
          }
          this.logger.trace(`removing channel: ${channel}`);
          await this.shared.remove(channel);
          await addOrRemoveChannel("removeChannel", channel);
      }
      async getWindowsOnChannel(channel) {
          this.validateChannelArg(channel);
          const windowInfos = await this.getWindowsWithChannels({ channels: [channel] });
          return windowInfos.map((w) => w.window);
      }
      async getWindowsWithChannels(filter) {
          this.validateWindowsWithChannelsFilter(filter);
          try {
              const info = await getChannelsInfo(filter);
              const windowsAPI = this.getWindowsAPI();
              if (info === null || info === void 0 ? void 0 : info.windows) {
                  return info.windows.reduce((memo, windowInfo) => {
                      const window = windowsAPI.findById(windowInfo.windowId);
                      memo.push({
                          window,
                          channel: windowInfo.channel,
                          application: windowInfo.application
                      });
                      return memo;
                  }, []);
              }
          }
          catch (er) {
              this.logger.error(`Error getting all channel enabled windows. This method is available since Glue42 3.12`, er);
          }
          return [];
      }
      async restrict(restriction) {
          this.validateRestrictionConfig(restriction);
          return setRestrictions(restriction);
      }
      async getRestrictions(windowId) {
          if (windowId) {
              this.validateWindowIdArg(windowId);
          }
          return getRestrictionsByWindow(windowId);
      }
      async restrictAll(restriction) {
          this.validateRestrictionConfig(restriction);
          return setRestrictionsForAllChannels(restriction);
      }
      handleRestrictionsChanged(restrictions, windowId) {
          this.registry.execute("restrictions-changed", {
              restrictions,
              windowId
          });
      }
      async clearChannelData(channel) {
          const channelName = typeof channel === "string" ? channel : this.currentChannelID.toString();
          if (!channelName) {
              return;
          }
          if (!this.shared.isChannel(channelName)) {
              return;
          }
          const canPublish = (await this.getRestrictionsByChannel(channelName)).write;
          if (!canPublish) {
              return;
          }
          return this.shared.clearContextData(channelName);
      }
      handler(data, context, updaterId) {
          if (!context && !updaterId) {
              this.lastUpdate = undefined;
              return;
          }
          this.lastUpdate = { context, updaterId };
          this.pendingReplays = {};
          this.registry.execute(this.subsKey, data, context, updaterId);
      }
      async joinCore(name, changeSelector = true) {
          this.logger.trace(`joining channel "${name}" ${changeSelector ? "" : "from command"}`);
          if (typeof name !== "string") {
              throw new Error("Please provide the channel name as a string!");
          }
          const newId = this.getID(name);
          if (!this.isInitialJoin && this.currentChannelID.isOnChannel(newId.toString())) {
              this.logger.trace(`already on channel: "${name}" ${changeSelector ? "" : "from command"}`);
              return;
          }
          this.isInitialJoin = false;
          await Promise.all(newId.all().map((n) => this.verifyChannelExists(n)));
          this.currentChannelID.joinChannel(name);
          this.lastUpdate = undefined;
          this.logger.trace(`switching channel context to: "${name}" ${changeSelector ? "" : "from command"}`);
          await this.shared.switchChannel(this.currentChannelID.toString());
          if (changeSelector) {
              this.logger.trace(`switching UI channel to: "${name}" ${changeSelector ? "" : "from command"}`);
              await sendSwitchChannelUI(name);
              this.logger.trace(`switched UI channel to: "${name}" ${changeSelector ? "" : "from command"}`);
          }
          this.raiseChannelsChangedEvents();
          this.logger.trace(`joined channel: ${name} ${changeSelector ? "" : "from command"} - current channel/s: ${this.currentChannelID.toString()}`);
      }
      async verifyChannelExists(name) {
          const doesChannelExist = (channelName) => {
              const channelNames = this.shared.all();
              return channelNames.includes(channelName);
          };
          if (!doesChannelExist(name)) {
              const channelExistsPromise = new Promise((resolve, reject) => {
                  const intervalId = setInterval(() => {
                      if (doesChannelExist(name)) {
                          clearTimeout(timeoutId);
                          clearInterval(intervalId);
                          resolve();
                      }
                  }, 100);
                  const timeoutId = setTimeout(() => {
                      clearInterval(intervalId);
                      return reject(new Error(`A channel with name: ${name} doesn't exist!`));
                  }, 3000);
              });
              await channelExistsPromise;
          }
      }
      async leaveCore(changeSelector = true, channelID) {
          if (!this.currentChannelID.isJoinedToAnyChannel) {
              this.logger.trace(`leave called ${changeSelector ? "" : "from command"} when not joined to any channel change selector`);
              return;
          }
          if (channelID && !this.currentChannelID.isOnChannel(channelID)) {
              this.logger.trace(`leave called ${changeSelector ? "" : "from command"} when not joined to channel: "${channelID}"`);
              return;
          }
          this.logger.trace(`leaving context channel: "${channelID}" ${changeSelector ? "" : "from command"}`);
          this.currentChannelID.leaveChannel(channelID);
          await this.shared.leave(channelID);
          this.lastUpdate = undefined;
          this.raiseChannelsChangedEvents();
          if (changeSelector) {
              this.logger.trace(`switching UI channel to: "${channelID}" ${changeSelector ? "" : "from command"}`);
              await sendSwitchChannelUI(this.currentChannelID.toString());
              this.logger.trace(`switched UI channel to: "${channelID}" ${changeSelector ? "" : "from command"}`);
          }
          this.logger.trace(`left single channel: "${channelID}" ${changeSelector ? "" : "from command"} - current channel/s: "${this.currentChannelID.toString()}"`);
          return Promise.resolve();
      }
      async leaveCoreMulti(changeSelector = true, channelID) {
          this.logger.trace(`leaving multi channel: "${channelID.toString()}" ${changeSelector ? "" : "from command"}`);
          const currentChannels = this.currentChannelID.all();
          const isJoinedToChannel = currentChannels.some((c) => channelID.isOnChannel(c));
          if (!isJoinedToChannel || !this.currentChannelID.isJoinedToAnyChannel) {
              this.logger.trace(`leave called ${changeSelector ? "" : "from command"} when not joined to any channel`);
              return;
          }
          const channelName = channelID.toString();
          this.currentChannelID.leaveChannel(channelName);
          await this.shared.leave(channelName);
          this.lastUpdate = undefined;
          this.raiseChannelsChangedEvents();
          if (changeSelector) {
              this.logger.trace(`switching UI channel to: "${channelName}" ${changeSelector ? "" : "from command"}`);
              await sendLeaveChannel(channelName);
              this.logger.trace(`switched UI channel to: "${channelName}" ${changeSelector ? "" : "from command"}`);
          }
          this.logger.trace(`left multi channel: "${channelName}" ${changeSelector ? "" : "from command"} - current channel/s: ${this.currentChannelID.toString()}`);
          return Promise.resolve();
      }
      raiseChannelsChangedEvents() {
          this.registry.execute(this.changedKey, this.currentChannelID.toString());
          this.registry.execute(this.channelsChangedKey, this.currentChannelID.all());
      }
      async getRestrictionsByChannel(channelName) {
          var _a;
          const restrictions = (_a = this.channelRestrictions) !== null && _a !== void 0 ? _a : await getRestrictionsByWindow();
          if (!restrictions || !Array.isArray(restrictions.channels) || !restrictions.channels.find(c => c.name === channelName)) {
              return {
                  read: true,
                  write: true
              };
          }
          const byChannel = restrictions.channels.find(c => c.name === channelName);
          return byChannel;
      }
      onRestrictionsChanged(callback, callbackId, currentChannelName) {
          this.pendingRestrictionCallbacks.set(callbackId, {
              cb: callback,
              channelName: currentChannelName
          });
          if (this.onRestrictionsChangedSub) {
              return;
          }
          this.onRestrictionsChangedSub = this.registry.add("restrictions-changed", ({ restrictions }) => {
              this.logger.trace(`restrictions changed - ${JSON.stringify(restrictions)}`);
              this.pendingRestrictionCallbacks.forEach(({ cb, channelName }, id) => {
                  const currentChannel = restrictions.channels.find((c) => c.name === channelName);
                  if (!currentChannel) {
                      this.logger.trace(`channel "${channelName}" not found in restrictions`);
                      return;
                  }
                  if (currentChannel.read) {
                      this.pendingRestrictionCallbacks.delete(id);
                      if (this.pendingRestrictionCallbacks.values.length === 0 && this.onRestrictionsChangedSub) {
                          this.onRestrictionsChangedSub();
                          this.onRestrictionsChangedSub = null;
                      }
                      cb();
                  }
              });
          });
      }
      subscribeForChannelRestrictionsChange() {
          this.registry.add("restrictions-changed", (r) => {
              this.logger.trace(`channel restrictions changed - ${JSON.stringify(r.restrictions)}`);
              this.channelRestrictions = r.restrictions;
          });
      }
      validatePathArgs(path) {
          if (!path) {
              throw new Error("Please provide a valid path value argument");
          }
          if (typeof path !== "object") {
              throw new Error(`Path Value argument is not a valid object: ${JSON.stringify(path)}`);
          }
          if (!path.path) {
              throw new Error(`path property is missing from Path Value argument: ${JSON.stringify(path)}`);
          }
          if (!path.value) {
              throw new Error(`value property is missing from Path Value argument: ${JSON.stringify(path)}`);
          }
          if (typeof path.path !== "string") {
              throw new Error(`path property is not a valid string from the Path Value argument: ${JSON.stringify(path)}`);
          }
      }
      validatePublishOptions(options) {
          if ((typeof options !== "string" && typeof options !== "object") || Array.isArray(options)) {
              throw new Error("Provide options as a string or an object");
          }
          if (typeof options === "object") {
              this.validatePublishOptionsObject(options);
              return;
          }
          if (options === "string" && !options.length) {
              throw new Error("Provide options as a non-empty string");
          }
      }
      validatePublishOptionsObject(options) {
          if (typeof options !== "object" || Array.isArray(options)) {
              throw new Error("Provide options as an object");
          }
          if (options.name && (typeof options.name !== "string" || !options.name.length)) {
              throw new Error("Provide options.name as a non-empty string");
          }
          if (Object.keys(options).includes("fdc3") && typeof options.fdc3 !== "boolean") {
              throw new Error("Provide options.fdc3 as a boolean");
          }
      }
      async publishWithOptions(data, options) {
          const channelName = options.name || this.currentChannelID.toString();
          if (!this.shared.isChannel(channelName)) {
              throw new Error(`A channel with name: ${options.name} doesn't exist!`);
          }
          if (!channelName) {
              throw new Error("Cannot publish to channel, because not joined to a channel!");
          }
          const canPublish = (await this.getRestrictionsByChannel(channelName)).write;
          if (!canPublish) {
              throw new Error(`Window does not have permission to write to channel ${this.currentChannelID.toString()}`);
          }
          if (!options.fdc3) {
              return this.shared.updateData(channelName, data);
          }
          return this.publishFdc3Data(channelName, data);
      }
      async publishFdc3Data(channelName, data) {
          var _a;
          if (typeof data.type !== "string" || !((_a = data.type) === null || _a === void 0 ? void 0 : _a.length)) {
              throw new Error("Expected a valid FDC3 Context with compulsory 'type' field");
          }
          const { type, ...rest } = data;
          const parsedType = type.split(".").join("&");
          const fdc3DataToPublish = { [`fdc3_${parsedType}`]: rest };
          return this.shared.updateData(channelName, fdc3DataToPublish);
      }
      getWrappedSubscribeCallback(callback, id) {
          const wrappedCallback = async (_, context, updaterId) => {
              const restrictionByChannel = await this.getRestrictionsByChannel(context.name);
              const channelData = this.getDataWithFdc3Encoding(context);
              if (restrictionByChannel.read) {
                  callback(channelData, context, updaterId);
              }
              else {
                  this.onRestrictionsChanged(() => {
                      callback(channelData, context, updaterId);
                  }, id, context.name);
              }
          };
          return wrappedCallback;
      }
      getWrappedSubscribeCallbackWithFdc3Type(callback, id, fdc3Type) {
          const didReplay = { replayed: false };
          const wrappedCallback = async (_, context, updaterId) => {
              const restrictionByChannel = await this.getRestrictionsByChannel(context.name);
              const callbackWithTypesChecks = () => {
                  const { data, latest_fdc3_type } = context;
                  const searchedType = `fdc3_${fdc3Type.split(".").join("&")}`;
                  if (!data[searchedType]) {
                      return;
                  }
                  if (didReplay.replayed) {
                      return this.parseDataAndInvokeSubscribeCallback({ latestFdc3TypeEncoded: latest_fdc3_type, searchedType: fdc3Type, callback, context, updaterId });
                  }
                  const fdc3Data = { type: fdc3Type, ...data[searchedType] };
                  callback({ fdc3: fdc3Data }, context, updaterId);
                  didReplay.replayed = true;
              };
              if (restrictionByChannel.read) {
                  callbackWithTypesChecks();
                  return;
              }
              this.onRestrictionsChanged(callbackWithTypesChecks, id, context.name);
          };
          return wrappedCallback;
      }
      parseDataAndInvokeSubscribeCallback(args) {
          const { latestFdc3TypeEncoded, searchedType, callback, context, updaterId } = args;
          const latestPublishedType = latestFdc3TypeEncoded.split("&").join(".");
          if (latestPublishedType !== searchedType) {
              return;
          }
          const fdc3Data = { type: searchedType, ...context.data[`fdc3_${latestFdc3TypeEncoded}`] };
          callback({ fdc3: fdc3Data }, context, updaterId);
      }
      getContextWithFdc3Type(context, searchedType) {
          var _a, _b;
          if (((_b = (_a = context.data) === null || _a === void 0 ? void 0 : _a.fdc3) === null || _b === void 0 ? void 0 : _b.type) === searchedType) {
              return {
                  name: context.name,
                  meta: context.meta,
                  data: { fdc3: context.data.fdc3 }
              };
          }
          const encodedType = `fdc3_${searchedType.split(".").join("&")}`;
          if (!context.data[encodedType]) {
              return {
                  name: context.name,
                  meta: context.meta,
                  data: {}
              };
          }
          const fdc3Context = { type: searchedType, ...context.data[encodedType] };
          return {
              name: context.name,
              meta: context.meta,
              data: { fdc3: fdc3Context }
          };
      }
      getDataWithFdc3Encoding(context) {
          const { data, latest_fdc3_type } = context;
          if (!latest_fdc3_type) {
              return data;
          }
          const parsedType = latest_fdc3_type.split("&").join(".");
          const latestTypePropName = `fdc3_${latest_fdc3_type}`;
          const fdc3Data = { type: parsedType, ...data[latestTypePropName] };
          const { [latestTypePropName]: latestFDC3Type, ...rest } = data;
          return { ...rest, fdc3: fdc3Data };
      }
      getID(id) {
          if (this.mode === "multi") {
              return new MultiChannelId(id);
          }
          else {
              return new SingleChannelID(id);
          }
      }
      leaveWhenSingle(channelName, windowId) {
          if (windowId) {
              this.logger.trace(`leaving single channel "${channelName}" for window: "${windowId}"`);
              return sendSwitchChannelUI(undefined, windowId);
          }
          this.logger.trace(`leaving single channel "${channelName}" for our window`);
          return this.leaveCore(true, channelName);
      }
      async leaveWhenMulti(channelName, windowId) {
          if (windowId) {
              this.logger.trace(`leaving multi channel "${channelName}" for window: "${windowId}"`);
              return sendLeaveChannel(channelName, windowId);
          }
          else {
              const channelId = channelName ? new MultiChannelId(channelName) : this.currentChannelID;
              this.logger.trace(`leaving multi channel "${channelId.toString()}" for our window`);
              return this.leaveCoreMulti(true, channelId);
          }
      }
      validateWindowIdArg(windowId) {
          if (typeof windowId !== "string") {
              throw new Error("The window ID must be a non-empty string!");
          }
          const windows = this.getWindowsAPI();
          if (!windows.findById(windowId)) {
              throw new Error(`Window with ID "${windowId}" doesn't exist!`);
          }
      }
      validateChannelArg(channel) {
          if (!channel) {
              throw new Error("Please provide a valid Channel name as a non-empty string!");
          }
          if (typeof channel !== "string") {
              throw new Error("The Channel name must be a non-empty string!");
          }
          const channelNames = this.shared.all();
          if (channelNames.every((name) => name !== channel)) {
              throw new Error(`Channel "${channel}" does not exist!"`);
          }
      }
      validateWindowsWithChannelsFilter(filter) {
          if (filter === undefined) {
              return;
          }
          if (filter === null || Array.isArray(filter) || typeof filter !== "object") {
              throw new Error("The `filter` argument must be a valid object!");
          }
      }
      isRestrictions(restriction) {
          return 'name' in restriction;
      }
      validateRestrictionConfig(restriction) {
          if (restriction === null || restriction === undefined || Array.isArray(restriction) || typeof restriction !== "object") {
              throw new Error("The `restrictions` argument must be a valid object with Channel restrictions!");
          }
          if (this.isRestrictions(restriction) && typeof restriction.name !== "string") {
              throw new Error("The `name` restriction property must be a non-empty string!");
          }
          if (restriction.read !== null && restriction.read !== undefined && typeof restriction.read !== "boolean") {
              throw new Error("The `read` restriction property must be a boolean value!");
          }
          if (restriction.write !== null && restriction.write !== undefined && typeof restriction.write !== "boolean") {
              throw new Error("The `write` restriction property must be a boolean value!");
          }
          if ((restriction.read === null || restriction.read === undefined) && (restriction.write === null || restriction.write === undefined)) {
              throw new Error("It's required to set either the `read` or the `write` property of the Channel restriction object!");
          }
          if (restriction.windowId !== null && restriction.windowId !== undefined) {
              this.validateWindowIdArg(restriction.windowId);
          }
      }
  }

  function factory$4(config, contexts, agm, getWindowsAPI, getAppManagerAPI, logger) {
      const channelsReadyPromise = getChannelInitInfo(config, agm)
          .then(async ({ mode, initialChannel }) => {
          const sharedContexts = mode === "single" ? new SharedContextSubscriber(contexts) : new MultiSharedContextSubscriber(contexts);
          if (mode === "multi") {
              logger.info(`multi-channel mode enabled`);
          }
          await channels.init(sharedContexts, mode, initialChannel);
          await setupInterop(agm, channels, logger);
          return true;
      });
      const channels = new ChannelsImpl(agm, getWindowsAPI, getAppManagerAPI, logger);
      return {
          subscribe: channels.subscribe.bind(channels),
          subscribeFor: channels.subscribeFor.bind(channels),
          publish: channels.publish.bind(channels),
          setPath: channels.setPath.bind(channels),
          setPaths: channels.setPaths.bind(channels),
          all: channels.all.bind(channels),
          list: channels.list.bind(channels),
          get: channels.get.bind(channels),
          join: channels.join.bind(channels),
          leave: channels.leave.bind(channels),
          restrict: channels.restrict.bind(channels),
          getRestrictions: channels.getRestrictions.bind(channels),
          clearChannelData: channels.clearChannelData.bind(channels),
          restrictAll: channels.restrictAll.bind(channels),
          current: channels.current.bind(channels),
          my: channels.my.bind(channels),
          changed: channels.changed.bind(channels),
          onChanged: channels.onChanged.bind(channels),
          add: channels.add.bind(channels),
          remove: channels.remove.bind(channels),
          getWindowsOnChannel: channels.getWindowsOnChannel.bind(channels),
          getWindowsWithChannels: channels.getWindowsWithChannels.bind(channels),
          getMy: channels.getMy.bind(channels),
          ready: async () => {
              await Promise.all([contexts.ready(), channelsReadyPromise]);
          },
          get mode() { return channels.mode; },
          getMyChannels: channels.getMyChannels.bind(channels),
          myChannels: channels.myChannels.bind(channels),
          onChannelsChanged: channels.onChannelsChanged.bind(channels),
      };
  }

  const CommandMethod = "T42.Hotkeys.Command";
  const InvokeMethod = "T42.Hotkeys.Invoke";
  const RegisterCommand = "register";
  const UnregisterCommand = "unregister";
  const UnregisterAllCommand = "unregisterAll";
  class HotkeysImpl {
      constructor(agm) {
          this.agm = agm;
          this.registry = CallbackRegistryFactory();
          this.firstHotkey = true;
          this.hotkeys = new Map();
      }
      async register(info, callback) {
          if (typeof info === "undefined") {
              throw new Error("Hotkey parameter missing");
          }
          if (typeof info === "string") {
              info = {
                  hotkey: info
              };
          }
          else {
              if (!info.hotkey) {
                  throw new Error("Info's hotkey parameter missing");
              }
              info = {
                  hotkey: info.hotkey,
                  description: info.description
              };
          }
          const hkToLower = this.formatHotkey(info.hotkey);
          if (this.hotkeys.has(hkToLower)) {
              throw new Error(`Shortcut for ${hkToLower} already registered`);
          }
          if (this.firstHotkey) {
              this.firstHotkey = false;
              await this.registerInvokeAGMMethod();
          }
          this.registry.add(hkToLower, callback);
          await this.agm.invoke(CommandMethod, { command: RegisterCommand, hotkey: hkToLower, description: info.description }, "best", {
              waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
              methodResponseTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS
          });
          this.hotkeys.set(hkToLower, info);
      }
      async unregister(hotkey) {
          if (typeof hotkey === "undefined") {
              throw new Error("hotkey parameter missing");
          }
          if (typeof hotkey !== "string") {
              throw new Error("hotkey parameter must be string");
          }
          const hkToLower = this.formatHotkey(hotkey);
          await this.agm.invoke(CommandMethod, { command: UnregisterCommand, hotkey: hkToLower }, "best", {
              waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
              methodResponseTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS
          });
          this.hotkeys.delete(hkToLower);
          this.registry.clearKey(hkToLower);
      }
      async unregisterAll() {
          await this.agm.invoke(CommandMethod, { command: UnregisterAllCommand }, "best", {
              waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
              methodResponseTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS
          });
          this.hotkeys.clear();
          this.registry.clear();
      }
      isRegistered(hotkey) {
          const hkToLower = this.formatHotkey(hotkey);
          return this.hotkeys.has(hkToLower);
      }
      registerInvokeAGMMethod() {
          return this.agm.register(InvokeMethod, (args) => {
              const hkToLower = args.key.toLowerCase();
              const info = this.hotkeys.get(hkToLower);
              this.registry.execute(hkToLower, info);
          });
      }
      formatHotkey(hotkey) {
          if (hotkey) {
              return hotkey.replace(/\s/g, "").toLowerCase();
          }
      }
  }

  function factory$3(agm) {
      const hotkeys = new HotkeysImpl(agm);
      return {
          register: hotkeys.register.bind(hotkeys),
          unregister: hotkeys.unregister.bind(hotkeys),
          unregisterAll: hotkeys.unregisterAll.bind(hotkeys),
          isRegistered: hotkeys.isRegistered.bind(hotkeys),
          ready: () => Promise.resolve()
      };
  }

  var version = "6.12.0";

  var prepareConfig = (options) => {
      function getLibConfig(value, defaultMode, trueMode) {
          if (typeof value === "boolean" && !value) {
              return undefined;
          }
          const mode = getModeAsString(value, defaultMode, trueMode);
          if (typeof mode === "undefined") {
              return undefined;
          }
          if (typeof value === "object") {
              value.mode = mode;
              return value;
          }
          return {
              mode,
          };
      }
      function getModeAsString(value, defaultMode, trueMode) {
          if (typeof value === "object") {
              return getModeAsString(value.mode, defaultMode, trueMode).toString();
          }
          else if (typeof value === "undefined") {
              if (typeof defaultMode === "boolean" && !defaultMode) {
                  return undefined;
              }
              else if (typeof defaultMode === "boolean" && defaultMode) {
                  return typeof trueMode === "undefined" ? defaultMode : trueMode;
              }
              else if (typeof defaultMode === "undefined") {
                  return undefined;
              }
              else {
                  return defaultMode;
              }
          }
          else if (typeof value === "boolean") {
              if (value) {
                  return (typeof trueMode === "undefined") ? defaultMode : trueMode;
              }
              else {
                  return undefined;
              }
          }
          return value;
      }
      const appDefaultMode = true;
      const appDefaultTrueMode = "startOnly";
      const activitiesDefaultMode = Utils.isNode() ? false : "trackMyTypeAndInitiatedFromMe";
      const activitiesTrueMode = "trackMyTypeAndInitiatedFromMe";
      const layoutsDefaultMode = "slim";
      const layoutsTrueMode = layoutsDefaultMode;
      const channelsConfig = () => {
          if (typeof options.channels === "boolean") {
              return options.channels;
          }
          else if (typeof options.channels === "object" && typeof options.channels.enabled === "boolean" && options.channels.enabled) {
              return { mode: true, ...options.channels };
          }
          else {
              return false;
          }
      };
      const exposeAPI = typeof options.exposeAPI === "boolean" || typeof options.exposeGlue === "boolean";
      return {
          layouts: getLibConfig(options.layouts, layoutsDefaultMode, layoutsTrueMode),
          activities: getLibConfig(options.activities, activitiesDefaultMode, activitiesTrueMode),
          appManager: getLibConfig(options.appManager, appDefaultMode, appDefaultTrueMode),
          windows: getLibConfig(options.windows, true, true),
          channels: getLibConfig(channelsConfig(), false, true),
          displays: getLibConfig(options.displays, true, true),
          exposeAPI: exposeAPI ? exposeAPI : true
      };
  };

  class Glue42Notification {
      constructor(options) {
          this.options = options;
          this.callbacks = CallbackRegistryFactory();
          this.actions = options.actions;
          this.body = options.body;
          this.badge = options.badge;
          this.data = options.data;
          this.dir = options.dir;
          this.icon = options.icon;
          this.image = options.image;
          this.lang = options.lang;
          this.renotify = options.renotify;
          this.requireInteraction = options.requireInteraction;
          this.silent = options.silent;
          this.tag = options.tag;
          this.timestamp = options.timestamp;
          this.title = options.title;
      }
      close() {
          throw new Error("Method not implemented.");
      }
      addEventListener(type, listener, options) {
          this.callbacks.add(type, listener);
      }
      removeEventListener(type, listener, options) {
      }
      dispatchEvent(event) {
          this.callbacks.execute(event.type, event);
          return true;
      }
  }

  class PanelAPI {
      constructor(interop, onStreamEvent) {
          this.interop = interop;
          this.onStreamEvent = onStreamEvent;
      }
      onVisibilityChanged(callback) {
          return this.onStreamEvent("on-panel-visibility-changed", callback);
      }
      toggle() {
          return this.interop.invoke("T42.Notifications.Show", undefined, "best", {
              waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
              methodResponseTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS
          });
      }
      show() {
          return this.interop.invoke("T42.Notifications.Show", { show: true }, "best", {
              waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
              methodResponseTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS
          });
      }
      hide() {
          return this.interop.invoke("T42.Notifications.Hide");
      }
      async isVisible() {
          const interopResult = await this.interop.invoke("T42.Notifications.Execute", { command: "isPanelVisible" }, "best", {
              waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
              methodResponseTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS
          });
          return interopResult.returned.panelVisible;
      }
      toAPI() {
          return {
              onVisibilityChanged: this.onVisibilityChanged.bind(this),
              toggle: this.toggle.bind(this),
              show: this.show.bind(this),
              hide: this.hide.bind(this),
              isVisible: this.isVisible.bind(this)
          };
      }
  }

  const STARTING_INDEX = 0;
  class Notifications {
      constructor(interop, logger) {
          this.interop = interop;
          this.NotificationsSubscribeStream = "T42.GNS.Subscribe.Notifications";
          this.NotificationsCounterStream = "T42.Notifications.Counter";
          this.RaiseNotificationMethodName = "T42.GNS.Publish.RaiseNotification";
          this.NotificationsExecuteMethod = "T42.Notifications.Execute";
          this.NotificationFilterMethodName = "T42.Notifications.Filter";
          this.methodsRegistered = false;
          this.NOTIFICATIONS_CONFIGURE_METHOD_NAME = "T42.Notifications.Configure";
          this.methodNameRoot = "T42.Notifications.Handler-" + Utils.generateId();
          this.nextId = 0;
          this.notifications = {};
          this.registry = CallbackRegistryFactory();
          this.subscribedForNotifications = false;
          this.subscribedCounterStream = false;
          this.subscriptionsCountForNotifications = 0;
          this.subscriptionsCountForCounter = 0;
          this.logger = logger.subLogger("notifications");
          this._panel = new PanelAPI(interop, this.onStreamEventCore.bind(this));
          this._panelAPI = this._panel.toAPI();
          this.subscribeInternalEvents();
      }
      get maxActions() {
          return 10;
      }
      get panel() {
          return this._panelAPI;
      }
      async raise(options) {
          var _a;
          const notification = await this.createNotification(options);
          const g42notification = new Glue42Notification(options);
          this.notifications[notification.id] = g42notification;
          try {
              const invocationResult = await this.interop.invoke(this.RaiseNotificationMethodName, { notification }, "best", {
                  waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
                  methodResponseTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS
              });
              g42notification.id = (_a = invocationResult.returned) === null || _a === void 0 ? void 0 : _a.id;
          }
          catch (err) {
              const errorMessage = err.message;
              setTimeout(() => {
                  this.handleNotificationErrorEvent(g42notification, errorMessage);
              }, 1);
          }
          return g42notification;
      }
      async setFilter(filter) {
          const result = await this.interop.invoke(this.NotificationFilterMethodName, filter, "best", {
              waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
              methodResponseTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS
          });
          return result.returned;
      }
      async getFilter() {
          const result = await this.interop.invoke(this.NotificationFilterMethodName, undefined, "best", {
              waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
              methodResponseTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS
          });
          return result.returned;
      }
      async configure(options) {
          var _a, _b, _c, _d, _e, _f, _g, _h;
          if (!options || Array.isArray(options)) {
              throw new Error("Invalid options - should be an object.");
          }
          if (Object.values(options).length === 0) {
              throw new Error("The argument must be a non-empty object.");
          }
          if (typeof options.enable !== "undefined" && typeof options.enable !== "boolean") {
              throw new Error("Expected type of enabled - boolean.");
          }
          if (typeof options.enableToasts !== "undefined" && typeof options.enableToasts !== "boolean") {
              throw new Error("Expected type of enableToasts - boolean.");
          }
          if (typeof options.toastExpiry !== "undefined" && typeof options.toastExpiry !== "number") {
              throw new Error("Expected type of toastExpiry - number.");
          }
          if (options.sourceFilter && typeof options.sourceFilter !== "object") {
              throw new Error("Expected type of sourceFilter - object.");
          }
          if (((_a = options.sourceFilter) === null || _a === void 0 ? void 0 : _a.allowed) && !Array.isArray((_b = options.sourceFilter) === null || _b === void 0 ? void 0 : _b.allowed)) {
              throw new Error("Expected type of sourceFilter.allowed - array.");
          }
          if (((_c = options.sourceFilter) === null || _c === void 0 ? void 0 : _c.blocked) && !Array.isArray((_d = options.sourceFilter) === null || _d === void 0 ? void 0 : _d.blocked)) {
              throw new Error("Expected type of sourceFilter.blocked - array.");
          }
          if (options.toasts && typeof options.toasts !== "object") {
              throw new Error("Expected type of (options.toasts - object.");
          }
          if (((_e = options.toasts) === null || _e === void 0 ? void 0 : _e.mode) && typeof options.toasts.mode !== "string") {
              throw new Error("Expected type of (options.toasts.mode - string.");
          }
          if (((_f = options.toasts) === null || _f === void 0 ? void 0 : _f.stackBy) && typeof options.toasts.stackBy !== "string") {
              throw new Error("Expected type of (options.toasts.stackBy - string.");
          }
          if (options.placement && typeof options.placement !== "object") {
              throw new Error("Expected type of (options.placement - object.");
          }
          if (((_g = options.placement) === null || _g === void 0 ? void 0 : _g.toasts) && typeof options.placement.toasts !== "string") {
              throw new Error("Expected type of (options.placement.toasts - string.");
          }
          if (((_h = options.placement) === null || _h === void 0 ? void 0 : _h.panel) && typeof options.placement.panel !== "string") {
              throw new Error("Expected type of (options.placement.panel - string.");
          }
          if (typeof options.closeNotificationOnClick !== "undefined" && typeof options.closeNotificationOnClick !== "boolean") {
              throw new Error("Expected type of closeNotificationOnClick - boolean.");
          }
          const result = await this.interop.invoke(this.NOTIFICATIONS_CONFIGURE_METHOD_NAME, options, "best", {
              waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
              methodResponseTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS
          });
          return result.returned;
      }
      async getConfiguration() {
          const result = await this.interop.invoke(this.NotificationsExecuteMethod, { command: "getConfiguration" }, "best", {
              waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
              methodResponseTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS
          });
          return result.returned;
      }
      async list() {
          const interopResult = await this.interop.invoke(this.NotificationsExecuteMethod, {
              command: "list",
              data: { statesVersion2: true }
          }, "best", {
              waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
              methodResponseTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS
          });
          return interopResult.returned.notifications;
      }
      async updateData(id, data) {
          const replacer = (key, value) => typeof value === "undefined" ? null : value;
          const attribute = {
              key: "data",
              value: {
                  stringValue: JSON.stringify(data, replacer)
              }
          };
          const interopResult = await this.interop.invoke(this.NotificationsExecuteMethod, { command: "create-or-update-attribute", data: { id, attribute } }, "best", {
              waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
              methodResponseTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS
          });
          return interopResult.returned;
      }
      onRaised(callback) {
          return this.onStreamEventCore("on-notification-raised", callback);
      }
      onStateChanged(callback) {
          return this.onStreamEventCore("on-state-changed", callback);
      }
      onClosed(callback) {
          return this.onStreamEventCore("on-notification-closed", callback);
      }
      onConfigurationChanged(callback) {
          if (typeof callback !== "function") {
              throw new Error("Please provide the callback as a function!");
          }
          this.subscribe();
          const un = this.registry.add("on-configuration-changed", callback);
          return () => {
              un();
              this.closeStreamSubscriptionIfNoNeeded();
          };
      }
      onCounterChanged(callback) {
          if (typeof callback !== "function") {
              throw new Error("Please provide the callback as a function!");
          }
          this.subscribeForCounterStream();
          const un = this.registry.add("on-counter-changed", callback);
          return () => {
              un();
              this.closeStreamCounterSubscriptionIfNoNeeded();
          };
      }
      onDataChanged(callback) {
          if (typeof callback !== "function") {
              throw new Error("Please provide the callback as a function!");
          }
          this.subscribe();
          const un = this.registry.add("on-notification-data-changed", callback);
          return () => {
              un();
              this.closeStreamSubscriptionIfNoNeeded();
          };
      }
      async clearAll() {
          await this.interop.invoke(this.NotificationsExecuteMethod, { command: "clearAll" }, "best", {
              waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
              methodResponseTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS
          });
      }
      async clearOld() {
          await this.interop.invoke(this.NotificationsExecuteMethod, { command: "clearAllOld", data: { statesVersion2: true } }, "best", {
              waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
              methodResponseTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS
          });
      }
      async clear(id) {
          if (!id) {
              throw new Error("The 'id' argument cannot be null or undefined");
          }
          if (typeof (id) !== "string") {
              throw new Error("The 'id' argument must be a string");
          }
          await this.interop.invoke(this.NotificationsExecuteMethod, { command: "clear", data: { id } }, "best", {
              waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
              methodResponseTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS
          });
      }
      async clearMany(notifications) {
          this.validateNotificationsArr(notifications);
          await this.interop.invoke(this.NotificationsExecuteMethod, { command: "clearMany", data: { notifications } }, "best", {
              waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
              methodResponseTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS
          });
      }
      async click(id, action, options) {
          await this.interop.invoke(this.NotificationsExecuteMethod, { command: "click", data: { id, action, options } }, "best", {
              waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
              methodResponseTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS
          });
      }
      async snooze(id, duration) {
          await this.interop.invoke(this.NotificationsExecuteMethod, { command: "snooze", data: { id, duration } }, "best", {
              waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
              methodResponseTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS
          });
      }
      async snoozeMany(notifications, duration) {
          if (!duration) {
              throw new Error("The 'duration' argument cannot be null or undefined");
          }
          if (typeof duration !== "number") {
              throw new Error("The 'duration' argument must be a valid number");
          }
          this.validateNotificationsArr(notifications);
          await this.interop.invoke(this.NotificationsExecuteMethod, { command: "snoozeMany", data: { notifications, duration } }, "best", {
              waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
              methodResponseTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS
          });
      }
      async setState(id, state) {
          if (!id) {
              throw new Error("The 'id' argument cannot be null or undefined");
          }
          if (typeof (id) !== "string") {
              throw new Error("The 'id' argument must be a string");
          }
          if (!state) {
              throw new Error("The 'state' argument cannot be null or undefined");
          }
          this.validateState(state);
          await this.interop.invoke(this.NotificationsExecuteMethod, { command: "updateState", data: { id, state } }, "best", {
              waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
              methodResponseTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS
          });
      }
      async setStates(notifications, state) {
          if (!state) {
              throw new Error("The 'state' argument cannot be null or undefined");
          }
          if (typeof state !== "string") {
              throw new Error("The 'state' argument must be a valid string");
          }
          this.validateNotificationsArr(notifications);
          await this.interop.invoke(this.NotificationsExecuteMethod, { command: "updateStates", data: { notifications, state } }, "best", {
              waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
              methodResponseTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS
          });
      }
      toAPI() {
          return {
              maxActions: this.maxActions,
              panel: this._panel.toAPI(),
              raise: this.raise.bind(this),
              setFilter: this.setFilter.bind(this),
              getFilter: this.getFilter.bind(this),
              configure: this.configure.bind(this),
              getConfiguration: this.getConfiguration.bind(this),
              list: this.list.bind(this),
              onRaised: this.onRaised.bind(this),
              onStateChanged: this.onStateChanged.bind(this),
              onClosed: this.onClosed.bind(this),
              onConfigurationChanged: this.onConfigurationChanged.bind(this),
              onCounterChanged: this.onCounterChanged.bind(this),
              onDataChanged: this.onDataChanged.bind(this),
              clearAll: this.clearAll.bind(this),
              clearOld: this.clearOld.bind(this),
              clear: this.clear.bind(this),
              click: this.click.bind(this),
              setState: this.setState.bind(this),
              updateData: this.updateData.bind(this),
              snooze: this.snooze.bind(this),
              snoozeMany: this.snoozeMany.bind(this),
              clearMany: this.clearMany.bind(this),
              setStates: this.setStates.bind(this),
              import: this.importNotifications.bind(this)
          };
      }
      async importNotifications(notifications) {
          if (!notifications || !Array.isArray(notifications) || notifications.length === 0) {
              throw new Error("Notifications argument must be a valid array with notification options");
          }
          const notificationsToImport = await Promise.all(notifications.map((notificationOptions) => this.createNotification(notificationOptions, true)));
          const invocationResult = await this.interop.invoke(this.NotificationsExecuteMethod, { command: "importNotifications", data: { notificationSettings: notificationsToImport } }, "best", {
              waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
              methodResponseTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS
          });
          return invocationResult.returned.notifications;
      }
      async createNotification(options, imported) {
          var _a, _b, _c, _d;
          this.validate(options, imported);
          if (!this.methodsRegistered) {
              const bunchOfPromises = [];
              for (let index = STARTING_INDEX; index < this.maxActions; index++) {
                  bunchOfPromises.push(this.interop.register(`${this.methodNameRoot}_${index}`, this.handleNotificationEvent.bind(this)));
              }
              this.methodsRegistered = true;
              await Promise.all(bunchOfPromises);
          }
          const id = (_a = options.id) !== null && _a !== void 0 ? _a : Utils.generateId();
          const type = (_b = options.type) !== null && _b !== void 0 ? _b : "Notification";
          const notification = {
              id,
              state: (_c = options.state) !== null && _c !== void 0 ? _c : "Active",
              title: options.title,
              type,
              severity: (_d = options.severity) !== null && _d !== void 0 ? _d : "None",
              description: options.body,
              glueRoutingDetailMethodName: `${this.methodNameRoot}_${STARTING_INDEX}`,
              actions: [],
              sourceId: id,
              source: options.source,
              publishExtraEvents: true,
              clickInterop: options.clickInterop
          };
          if (options.actions) {
              this.handleActions(options, id, notification);
          }
          this.handleOptions(options, notification);
          return notification;
      }
      onStreamEventCore(key, callback) {
          if (typeof callback !== "function") {
              throw new Error("Please provide the callback as a function!");
          }
          this.subscribe();
          const un = this.registry.add(key, callback);
          return () => {
              un();
              this.closeStreamSubscriptionIfNoNeeded();
          };
      }
      handleOptions(options, notification) {
          if (options.icon) {
              notification.attributes = notification.attributes || [];
              notification.attributes.push({ key: "icon", value: { stringValue: options.icon } });
          }
          if (options.data) {
              notification.attributes = notification.attributes || [];
              const dataAsString = JSON.stringify(options.data);
              notification.attributes.push({ key: "data", value: { stringValue: dataAsString } });
          }
          if (typeof options.panelExpiry === "number") {
              notification.attributes = notification.attributes || [];
              notification.attributes.push({ key: "panelExpiry", value: { stringValue: options.panelExpiry.toString() } });
          }
          if (typeof options.toastExpiry === "number") {
              notification.attributes = notification.attributes || [];
              notification.attributes.push({ key: "toastExpiry", value: { stringValue: options.toastExpiry.toString() } });
          }
      }
      handleActions(options, id, notification) {
          var _a, _b, _c;
          const validActions = options.actions.slice(0, this.maxActions);
          let index = STARTING_INDEX;
          for (const action of validActions) {
              const args = {
                  g42notificationId: id,
                  g42action: action.action,
                  g42interopMethod: (_a = action.interop) === null || _a === void 0 ? void 0 : _a.method,
                  g42interopTarget: (_b = action.interop) === null || _b === void 0 ? void 0 : _b.target,
                  g42interopArguments: JSON.stringify((_c = action.interop) === null || _c === void 0 ? void 0 : _c.arguments)
              };
              const parameters = Object.keys(args).map((key) => {
                  const value = args[key];
                  return {
                      name: key,
                      value: {
                          stringValue: value
                      }
                  };
              });
              const glueAction = {
                  name: `${this.methodNameRoot}_${index}`,
                  description: action.title,
                  displayName: action.title,
                  displayPath: action.displayPath,
                  displayId: action.displayId,
                  parameters
              };
              notification.actions.push(glueAction);
              index++;
          }
      }
      validate(options, imported) {
          if (!options) {
              throw new Error("invalid options - should be an object");
          }
          if (typeof options !== "object") {
              throw new Error("invalid options - should be an object");
          }
          if (!options.title) {
              throw new Error("invalid options - should have a title");
          }
          if (typeof options.title !== "string") {
              throw new Error("invalid options - title should be a string");
          }
          if (options.severity && typeof options.severity !== "string") {
              throw new Error("invalid options - severity should be a string");
          }
          if (options.panelExpiry && typeof options.panelExpiry !== "number") {
              throw new Error("invalid options - panelExpiry should be a number");
          }
          if (options.toastExpiry && typeof options.toastExpiry !== "number") {
              throw new Error("invalid options - toastExpiry should be a number");
          }
          if (options.state) {
              this.validateState(options.state, imported);
          }
      }
      validateState(state, imported) {
          if (typeof (state) !== "string") {
              throw new Error("The 'state' argument must be a string");
          }
          const validStates = [
              "Active",
              "Acknowledged",
              "Stale"
          ];
          if (imported) {
              validStates.push("Seen", "Snoozed", "Processing", "Closed");
          }
          if (!validStates.includes(state)) {
              throw new Error(`The state argument: ${state} is not valid!`);
          }
      }
      subscribe() {
          this.subscriptionsCountForNotifications++;
          if (!this.subscribedForNotifications) {
              this.subscribedForNotifications = true;
              this.logger.info(`Attempting to subscribe to "${this.NotificationsSubscribeStream}".`);
              this.interop
                  .subscribe(this.NotificationsSubscribeStream, {
                  arguments: {
                      sendDeltaOnly: true,
                      statesVersion2: true
                  }
              })
                  .then((sub) => {
                  this.subscriptionForNotifications = sub;
                  this.logger.info(`Successfully subscribed to "${this.NotificationsSubscribeStream}".`);
                  sub.onData(({ data }) => {
                      this.handleData(data);
                  });
                  sub.onClosed((...args) => {
                      this.subscribedForNotifications = false;
                      this.logger.info(`Stream subscription Closed - ${JSON.stringify(args)}`);
                  });
                  sub.onFailed((...args) => {
                      this.subscribedForNotifications = false;
                      this.logger.warn(`Stream subscription Failed - ${JSON.stringify(args)}`);
                  });
              })
                  .catch((e) => {
                  this.subscribedForNotifications = false;
                  this.logger.error(`Unable to subscribe to "${this.NotificationsSubscribeStream}"`, e);
              });
          }
      }
      subscribeForCounterStream() {
          this.subscriptionsCountForCounter++;
          if (!this.subscribedCounterStream) {
              this.subscribedCounterStream = true;
              this.logger.info(`Attempting to subscribe to "${this.NotificationsCounterStream}".`);
              this.interop
                  .subscribe(this.NotificationsCounterStream, {
                  arguments: {
                      sendDeltaOnly: true
                  }
              })
                  .then((sub) => {
                  this.subscriptionForCounter = sub;
                  this.logger.info(`Successfully subscribed to "${this.NotificationsCounterStream}".`);
                  sub.onData(({ data }) => {
                      this.registry.execute("on-counter-changed", { count: data.count });
                  });
                  sub.onClosed((...args) => {
                      this.subscribedCounterStream = false;
                      this.logger.info(`Stream subscription Closed - ${JSON.stringify(args)}`);
                  });
                  sub.onFailed((...args) => {
                      this.subscribedCounterStream = false;
                      this.logger.warn(`Stream subscription Failed - ${JSON.stringify(args)}`);
                  });
              })
                  .catch((e) => {
                  this.subscribedCounterStream = false;
                  this.logger.error(`Unable to subscribe to "${this.NotificationsCounterStream}"`, e);
              });
          }
      }
      subscribeInternalEvents() {
          this.registry.add("on-notification-closed", (id) => {
              this.handleOnClosed(id);
          });
          this.registry.add("on-notification-raised", (notification) => {
              this.handleOnShow(notification.id);
          });
      }
      handleData(message) {
          var _a;
          try {
              if ("items" in message && Array.isArray(message.items)) {
                  this.handleItemsData(message);
              }
              else if ("deltas" in message && Array.isArray(message.deltas)) {
                  this.handleDeltas(message);
              }
              if ("configuration" in message && typeof message.configuration === "object") {
                  this.logger.info(`Received configuration ${JSON.stringify(message.configuration)} from the stream`);
                  this.registry.execute("on-configuration-changed", message.configuration, message.configuration.allApplications);
              }
              if ("command" in message && typeof message.command === "string") {
                  this.logger.info(`Received command "${(_a = message.command) !== null && _a !== void 0 ? _a : JSON.stringify(message)}" from the stream`);
                  if (message.command === "showPanel" || message.command === "hidePanel") {
                      this.registry.execute("on-panel-visibility-changed", message.command === "showPanel");
                  }
              }
          }
          catch (e) {
              this.logger.error(`Failed to parse data from the stream`, e);
          }
      }
      handleItemsData(message) {
          const items = message.items;
          this.logger.info(`Received ${items.length} notifications from the stream`);
          const notifications = items;
          if (message.isSnapshot) {
              notifications.forEach((n) => {
                  this.registry.execute("on-notification-raised", n);
              });
          }
          else {
              const notification = notifications[0];
              if (notification.state === "Closed") {
                  this.registry.execute("on-notification-closed", { id: notification.id });
              }
              else {
                  this.registry.execute("on-notification-raised", notification);
              }
          }
      }
      handleDeltas(message) {
          const deltas = message.deltas;
          deltas.forEach((info) => {
              var _a;
              const id = info.id;
              const delta = (_a = info.delta) !== null && _a !== void 0 ? _a : {};
              if (delta.state === "Closed") {
                  this.registry.execute("on-notification-closed", { id, ...delta });
              }
              else if (delta.state) {
                  this.registry.execute("on-state-changed", { id }, delta.state);
              }
              else if (delta.attributes) {
                  const attributes = delta.attributes;
                  const dataAttribute = attributes.find((a) => a.key === "data");
                  if (dataAttribute) {
                      this.registry.execute("on-notification-data-changed", { id }, JSON.parse(dataAttribute.value.stringValue));
                  }
              }
          });
      }
      handleOnClosed(id) {
          const { notification, key } = this.getNotification(id);
          if (notification) {
              this.handleEvent(notification, "close");
              delete this.notifications[key];
          }
      }
      handleOnShow(id) {
          const { notification } = this.getNotification(id);
          if (notification) {
              this.handleEvent(notification, "show");
          }
      }
      getNotification(id) {
          let notification;
          let key;
          for (const k in this.notifications) {
              if (this.notifications[k].id === id) {
                  notification = this.notifications[k];
                  key = k;
                  break;
              }
          }
          return { notification, key };
      }
      handleNotificationEvent(args) {
          const gnsNotificationArgs = this.getGnsNotificationArgs(args);
          if (gnsNotificationArgs.event === "unknown") {
              return;
          }
          const notification = this.notifications[gnsNotificationArgs.notificationId];
          if (!notification) {
              return;
          }
          this.handleNotificationEventCore(notification, gnsNotificationArgs);
      }
      handleNotificationEventCore(notification, args) {
          switch (args.event) {
              case "action": {
                  return this.handleNotificationActionEvent(notification, args.notificationActionPayload);
              }
              case "click": {
                  return this.handleNotificationClickEvent(notification);
              }
              case "close": {
                  return this.handleEvent(notification, "close");
              }
              case "error": {
                  return this.handleNotificationErrorEvent(notification, args.error);
              }
              case "show": {
                  return this.handleEvent(notification, "show");
              }
          }
      }
      handleNotificationActionEvent(notification, payload) {
          const event = {
              type: "onaction",
              action: payload.g42action
          };
          if (notification.onaction) {
              notification.onaction(event);
          }
          notification.dispatchEvent(event);
      }
      handleNotificationClickEvent(notification) {
          const event = { type: "onclick" };
          if (notification.onclick) {
              notification.onclick(event);
          }
          notification.dispatchEvent(event);
      }
      handleEvent(notification, eventType) {
          var _a;
          const event = { type: eventType };
          const eventName = `on${eventType}`;
          (_a = notification[eventName]) === null || _a === void 0 ? void 0 : _a.call(notification, event);
          notification.dispatchEvent(event);
      }
      handleNotificationErrorEvent(notification, error) {
          const event = { type: "onerror", error };
          if (notification.onerror) {
              notification.onerror(event);
          }
          notification.dispatchEvent(event);
      }
      getGnsNotificationArgs(args) {
          var _a;
          let result;
          const event = (_a = args.notification) === null || _a === void 0 ? void 0 : _a.event;
          if (!event) {
              result = this.getBackwardGnsNotificationArgs(args);
          }
          else {
              result = {
                  event,
                  notificationId: args.notification.sourceNotificationId,
                  notificationActionPayload: args
              };
          }
          return result;
      }
      getBackwardGnsNotificationArgs(args) {
          var _a;
          let result;
          if (args.g42notificationId) {
              result = {
                  event: "action",
                  notificationId: args.g42notificationId,
                  notificationActionPayload: args
              };
          }
          else if ((_a = args.notification) === null || _a === void 0 ? void 0 : _a.sourceNotificationId) {
              result = {
                  event: "click",
                  notificationId: args.notification.sourceNotificationId,
                  notificationActionPayload: args
              };
          }
          else {
              result = {
                  event: "unknown",
                  notificationId: undefined,
                  notificationActionPayload: args
              };
          }
          return result;
      }
      closeStreamSubscriptionIfNoNeeded() {
          this.subscriptionsCountForNotifications--;
          if (this.subscriptionForNotifications && this.subscriptionsCountForNotifications === 0) {
              this.subscriptionForNotifications.close();
              this.subscriptionForNotifications = undefined;
          }
      }
      closeStreamCounterSubscriptionIfNoNeeded() {
          this.subscriptionsCountForCounter--;
          if (this.subscriptionForCounter && this.subscriptionsCountForCounter === 0) {
              this.subscriptionForCounter.close();
              this.subscriptionForCounter = undefined;
          }
      }
      validateNotificationsArr(notifications) {
          if (!Array.isArray(notifications)) {
              throw new Error("The 'notifications' argument must be an array with valid notification IDs");
          }
          if (notifications.some((n) => typeof n !== "string")) {
              throw new Error("The 'notifications' argument must contain only valid string notification IDs");
          }
      }
  }

  const ThemesConfigurationMethodName = "T42.Themes.Configuration";
  class ThemesImpl {
      constructor(contexts, interop) {
          this.contexts = contexts;
          this.interop = interop;
          this.registry = CallbackRegistryFactory();
          this.isSubscribed = false;
          this.getConfiguration();
      }
      async list() {
          await this.getConfiguration();
          if (!this.getMethodName) {
              throw new Error("not supported");
          }
          return (await this.getAll()).returned.all;
      }
      async getCurrent() {
          await this.getConfiguration();
          if (!this.getMethodName) {
              throw new Error("not supported");
          }
          const all = await this.getAll();
          return all.returned.all.find((t) => t.name === all.returned.selected);
      }
      async select(theme) {
          await this.getConfiguration();
          if (!this.setMethodName) {
              throw new Error("not supported");
          }
          await this.interop.invoke(this.setMethodName, { theme });
      }
      onChanged(callback) {
          if (!callback) {
              throw new Error("Callback argument is required");
          }
          if (callback && typeof callback !== "function") {
              throw new Error("Callback argument must be a function");
          }
          this.subscribe();
          return this.registry.add("changed", callback);
      }
      async getConfiguration() {
          try {
              if (this.sharedContextName) {
                  return;
              }
              const config = await this.interop.invoke(ThemesConfigurationMethodName);
              this.sharedContextName = config.returned.sharedContextName;
              this.getMethodName = config.returned.getThemesMethodName;
              this.setMethodName = config.returned.setThemesMethodName;
          }
          catch (error) {
              return;
          }
      }
      async getAll() {
          await this.getConfiguration();
          return await this.interop.invoke(this.getMethodName);
      }
      async subscribe() {
          await this.getConfiguration();
          if (this.isSubscribed) {
              return;
          }
          this.isSubscribed = true;
          this.contexts.subscribe(this.sharedContextName, (data) => {
              if (data && data.all && data.selected) {
                  this.registry.execute("changed", data.all.find((t) => t.name === data.selected));
              }
          });
      }
  }

  function factory$2(contexts, interop) {
      const themes = new ThemesImpl(contexts, interop);
      return {
          list: themes.list.bind(themes),
          getCurrent: themes.getCurrent.bind(themes),
          select: themes.select.bind(themes),
          onChanged: themes.onChanged.bind(themes),
          ready: () => Promise.resolve(),
      };
  }

  const connectBrowserAppProps = ["name", "title", "version", "customProperties", "icon", "caption", "type"];
  const fdc3v2AppProps = ["appId", "name", "type", "details", "version", "title", "tooltip", "lang", "description", "categories", "icons", "screenshots", "contactEmail", "moreInfo", "publisher", "customConfig", "hostManifests", "interop", "localizedVersions"];

  /**
   * Wraps values in an `Ok` type.
   *
   * Example: `ok(5) // => {ok: true, result: 5}`
   */
  var ok = function (result) { return ({ ok: true, result: result }); };
  /**
   * Wraps errors in an `Err` type.
   *
   * Example: `err('on fire') // => {ok: false, error: 'on fire'}`
   */
  var err = function (error) { return ({ ok: false, error: error }); };
  /**
   * Create a `Promise` that either resolves with the result of `Ok` or rejects
   * with the error of `Err`.
   */
  var asPromise = function (r) {
      return r.ok === true ? Promise.resolve(r.result) : Promise.reject(r.error);
  };
  /**
   * Unwraps a `Result` and returns either the result of an `Ok`, or
   * `defaultValue`.
   *
   * Example:
   * ```
   * Result.withDefault(5, number().run(json))
   * ```
   *
   * It would be nice if `Decoder` had an instance method that mirrored this
   * function. Such a method would look something like this:
   * ```
   * class Decoder<A> {
   *   runWithDefault = (defaultValue: A, json: any): A =>
   *     Result.withDefault(defaultValue, this.run(json));
   * }
   *
   * number().runWithDefault(5, json)
   * ```
   * Unfortunately, the type of `defaultValue: A` on the method causes issues
   * with type inference on  the `object` decoder in some situations. While these
   * inference issues can be solved by providing the optional type argument for
   * `object`s, the extra trouble and confusion doesn't seem worth it.
   */
  var withDefault = function (defaultValue, r) {
      return r.ok === true ? r.result : defaultValue;
  };
  /**
   * Return the successful result, or throw an error.
   */
  var withException = function (r) {
      if (r.ok === true) {
          return r.result;
      }
      else {
          throw r.error;
      }
  };
  /**
   * Apply `f` to the result of an `Ok`, or pass the error through.
   */
  var map = function (f, r) {
      return r.ok === true ? ok(f(r.result)) : r;
  };
  /**
   * Apply `f` to the result of two `Ok`s, or pass an error through. If both
   * `Result`s are errors then the first one is returned.
   */
  var map2 = function (f, ar, br) {
      return ar.ok === false ? ar :
          br.ok === false ? br :
              ok(f(ar.result, br.result));
  };
  /**
   * Apply `f` to the error of an `Err`, or pass the success through.
   */
  var mapError = function (f, r) {
      return r.ok === true ? r : err(f(r.error));
  };
  /**
   * Chain together a sequence of computations that may fail, similar to a
   * `Promise`. If the first computation fails then the error will propagate
   * through. If it succeeds, then `f` will be applied to the value, returning a
   * new `Result`.
   */
  var andThen = function (f, r) {
      return r.ok === true ? f(r.result) : r;
  };

  /*! *****************************************************************************
  Copyright (c) Microsoft Corporation.

  Permission to use, copy, modify, and/or distribute this software for any
  purpose with or without fee is hereby granted.

  THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
  REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
  AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
  INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
  LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
  OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
  PERFORMANCE OF THIS SOFTWARE.
  ***************************************************************************** */
  /* global Reflect, Promise */



  var __assign = function() {
      __assign = Object.assign || function __assign(t) {
          for (var s, i = 1, n = arguments.length; i < n; i++) {
              s = arguments[i];
              for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p)) t[p] = s[p];
          }
          return t;
      };
      return __assign.apply(this, arguments);
  };

  function __rest(s, e) {
      var t = {};
      for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
          t[p] = s[p];
      if (s != null && typeof Object.getOwnPropertySymbols === "function")
          for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
              if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                  t[p[i]] = s[p[i]];
          }
      return t;
  }

  function isEqual(a, b) {
      if (a === b) {
          return true;
      }
      if (a === null && b === null) {
          return true;
      }
      if (typeof (a) !== typeof (b)) {
          return false;
      }
      if (typeof (a) === 'object') {
          // Array
          if (Array.isArray(a)) {
              if (!Array.isArray(b)) {
                  return false;
              }
              if (a.length !== b.length) {
                  return false;
              }
              for (var i = 0; i < a.length; i++) {
                  if (!isEqual(a[i], b[i])) {
                      return false;
                  }
              }
              return true;
          }
          // Hash table
          var keys = Object.keys(a);
          if (keys.length !== Object.keys(b).length) {
              return false;
          }
          for (var i = 0; i < keys.length; i++) {
              if (!b.hasOwnProperty(keys[i])) {
                  return false;
              }
              if (!isEqual(a[keys[i]], b[keys[i]])) {
                  return false;
              }
          }
          return true;
      }
  }
  /*
   * Helpers
   */
  var isJsonArray = function (json) { return Array.isArray(json); };
  var isJsonObject = function (json) {
      return typeof json === 'object' && json !== null && !isJsonArray(json);
  };
  var typeString = function (json) {
      switch (typeof json) {
          case 'string':
              return 'a string';
          case 'number':
              return 'a number';
          case 'boolean':
              return 'a boolean';
          case 'undefined':
              return 'undefined';
          case 'object':
              if (json instanceof Array) {
                  return 'an array';
              }
              else if (json === null) {
                  return 'null';
              }
              else {
                  return 'an object';
              }
          default:
              return JSON.stringify(json);
      }
  };
  var expectedGot = function (expected, got) {
      return "expected " + expected + ", got " + typeString(got);
  };
  var printPath = function (paths) {
      return paths.map(function (path) { return (typeof path === 'string' ? "." + path : "[" + path + "]"); }).join('');
  };
  var prependAt = function (newAt, _a) {
      var at = _a.at, rest = __rest(_a, ["at"]);
      return (__assign({ at: newAt + (at || '') }, rest));
  };
  /**
   * Decoders transform json objects with unknown structure into known and
   * verified forms. You can create objects of type `Decoder<A>` with either the
   * primitive decoder functions, such as `boolean()` and `string()`, or by
   * applying higher-order decoders to the primitives, such as `array(boolean())`
   * or `dict(string())`.
   *
   * Each of the decoder functions are available both as a static method on
   * `Decoder` and as a function alias -- for example the string decoder is
   * defined at `Decoder.string()`, but is also aliased to `string()`. Using the
   * function aliases exported with the library is recommended.
   *
   * `Decoder` exposes a number of 'run' methods, which all decode json in the
   * same way, but communicate success and failure in different ways. The `map`
   * and `andThen` methods modify decoders without having to call a 'run' method.
   *
   * Alternatively, the main decoder `run()` method returns an object of type
   * `Result<A, DecoderError>`. This library provides a number of helper
   * functions for dealing with the `Result` type, so you can do all the same
   * things with a `Result` as with the decoder methods.
   */
  var Decoder = /** @class */ (function () {
      /**
       * The Decoder class constructor is kept private to separate the internal
       * `decode` function from the external `run` function. The distinction
       * between the two functions is that `decode` returns a
       * `Partial<DecoderError>` on failure, which contains an unfinished error
       * report. When `run` is called on a decoder, the relevant series of `decode`
       * calls is made, and then on failure the resulting `Partial<DecoderError>`
       * is turned into a `DecoderError` by filling in the missing information.
       *
       * While hiding the constructor may seem restrictive, leveraging the
       * provided decoder combinators and helper functions such as
       * `andThen` and `map` should be enough to build specialized decoders as
       * needed.
       */
      function Decoder(decode) {
          var _this = this;
          this.decode = decode;
          /**
           * Run the decoder and return a `Result` with either the decoded value or a
           * `DecoderError` containing the json input, the location of the error, and
           * the error message.
           *
           * Examples:
           * ```
           * number().run(12)
           * // => {ok: true, result: 12}
           *
           * string().run(9001)
           * // =>
           * // {
           * //   ok: false,
           * //   error: {
           * //     kind: 'DecoderError',
           * //     input: 9001,
           * //     at: 'input',
           * //     message: 'expected a string, got 9001'
           * //   }
           * // }
           * ```
           */
          this.run = function (json) {
              return mapError(function (error) { return ({
                  kind: 'DecoderError',
                  input: json,
                  at: 'input' + (error.at || ''),
                  message: error.message || ''
              }); }, _this.decode(json));
          };
          /**
           * Run the decoder as a `Promise`.
           */
          this.runPromise = function (json) { return asPromise(_this.run(json)); };
          /**
           * Run the decoder and return the value on success, or throw an exception
           * with a formatted error string.
           */
          this.runWithException = function (json) { return withException(_this.run(json)); };
          /**
           * Construct a new decoder that applies a transformation to the decoded
           * result. If the decoder succeeds then `f` will be applied to the value. If
           * it fails the error will propagated through.
           *
           * Example:
           * ```
           * number().map(x => x * 5).run(10)
           * // => {ok: true, result: 50}
           * ```
           */
          this.map = function (f) {
              return new Decoder(function (json) { return map(f, _this.decode(json)); });
          };
          /**
           * Chain together a sequence of decoders. The first decoder will run, and
           * then the function will determine what decoder to run second. If the result
           * of the first decoder succeeds then `f` will be applied to the decoded
           * value. If it fails the error will propagate through.
           *
           * This is a very powerful method -- it can act as both the `map` and `where`
           * methods, can improve error messages for edge cases, and can be used to
           * make a decoder for custom types.
           *
           * Example of adding an error message:
           * ```
           * const versionDecoder = valueAt(['version'], number());
           * const infoDecoder3 = object({a: boolean()});
           *
           * const decoder = versionDecoder.andThen(version => {
           *   switch (version) {
           *     case 3:
           *       return infoDecoder3;
           *     default:
           *       return fail(`Unable to decode info, version ${version} is not supported.`);
           *   }
           * });
           *
           * decoder.run({version: 3, a: true})
           * // => {ok: true, result: {a: true}}
           *
           * decoder.run({version: 5, x: 'abc'})
           * // =>
           * // {
           * //   ok: false,
           * //   error: {... message: 'Unable to decode info, version 5 is not supported.'}
           * // }
           * ```
           *
           * Example of decoding a custom type:
           * ```
           * // nominal type for arrays with a length of at least one
           * type NonEmptyArray<T> = T[] & { __nonEmptyArrayBrand__: void };
           *
           * const nonEmptyArrayDecoder = <T>(values: Decoder<T>): Decoder<NonEmptyArray<T>> =>
           *   array(values).andThen(arr =>
           *     arr.length > 0
           *       ? succeed(createNonEmptyArray(arr))
           *       : fail(`expected a non-empty array, got an empty array`)
           *   );
           * ```
           */
          this.andThen = function (f) {
              return new Decoder(function (json) {
                  return andThen(function (value) { return f(value).decode(json); }, _this.decode(json));
              });
          };
          /**
           * Add constraints to a decoder _without_ changing the resulting type. The
           * `test` argument is a predicate function which returns true for valid
           * inputs. When `test` fails on an input, the decoder fails with the given
           * `errorMessage`.
           *
           * ```
           * const chars = (length: number): Decoder<string> =>
           *   string().where(
           *     (s: string) => s.length === length,
           *     `expected a string of length ${length}`
           *   );
           *
           * chars(5).run('12345')
           * // => {ok: true, result: '12345'}
           *
           * chars(2).run('HELLO')
           * // => {ok: false, error: {... message: 'expected a string of length 2'}}
           *
           * chars(12).run(true)
           * // => {ok: false, error: {... message: 'expected a string, got a boolean'}}
           * ```
           */
          this.where = function (test, errorMessage) {
              return _this.andThen(function (value) { return (test(value) ? Decoder.succeed(value) : Decoder.fail(errorMessage)); });
          };
      }
      /**
       * Decoder primitive that validates strings, and fails on all other input.
       */
      Decoder.string = function () {
          return new Decoder(function (json) {
              return typeof json === 'string'
                  ? ok(json)
                  : err({ message: expectedGot('a string', json) });
          });
      };
      /**
       * Decoder primitive that validates numbers, and fails on all other input.
       */
      Decoder.number = function () {
          return new Decoder(function (json) {
              return typeof json === 'number'
                  ? ok(json)
                  : err({ message: expectedGot('a number', json) });
          });
      };
      /**
       * Decoder primitive that validates booleans, and fails on all other input.
       */
      Decoder.boolean = function () {
          return new Decoder(function (json) {
              return typeof json === 'boolean'
                  ? ok(json)
                  : err({ message: expectedGot('a boolean', json) });
          });
      };
      Decoder.constant = function (value) {
          return new Decoder(function (json) {
              return isEqual(json, value)
                  ? ok(value)
                  : err({ message: "expected " + JSON.stringify(value) + ", got " + JSON.stringify(json) });
          });
      };
      Decoder.object = function (decoders) {
          return new Decoder(function (json) {
              if (isJsonObject(json) && decoders) {
                  var obj = {};
                  for (var key in decoders) {
                      if (decoders.hasOwnProperty(key)) {
                          var r = decoders[key].decode(json[key]);
                          if (r.ok === true) {
                              // tslint:disable-next-line:strict-type-predicates
                              if (r.result !== undefined) {
                                  obj[key] = r.result;
                              }
                          }
                          else if (json[key] === undefined) {
                              return err({ message: "the key '" + key + "' is required but was not present" });
                          }
                          else {
                              return err(prependAt("." + key, r.error));
                          }
                      }
                  }
                  return ok(obj);
              }
              else if (isJsonObject(json)) {
                  return ok(json);
              }
              else {
                  return err({ message: expectedGot('an object', json) });
              }
          });
      };
      Decoder.array = function (decoder) {
          return new Decoder(function (json) {
              if (isJsonArray(json) && decoder) {
                  var decodeValue_1 = function (v, i) {
                      return mapError(function (err$$1) { return prependAt("[" + i + "]", err$$1); }, decoder.decode(v));
                  };
                  return json.reduce(function (acc, v, i) {
                      return map2(function (arr, result) { return arr.concat([result]); }, acc, decodeValue_1(v, i));
                  }, ok([]));
              }
              else if (isJsonArray(json)) {
                  return ok(json);
              }
              else {
                  return err({ message: expectedGot('an array', json) });
              }
          });
      };
      Decoder.tuple = function (decoders) {
          return new Decoder(function (json) {
              if (isJsonArray(json)) {
                  if (json.length !== decoders.length) {
                      return err({
                          message: "expected a tuple of length " + decoders.length + ", got one of length " + json.length
                      });
                  }
                  var result = [];
                  for (var i = 0; i < decoders.length; i++) {
                      var nth = decoders[i].decode(json[i]);
                      if (nth.ok) {
                          result[i] = nth.result;
                      }
                      else {
                          return err(prependAt("[" + i + "]", nth.error));
                      }
                  }
                  return ok(result);
              }
              else {
                  return err({ message: expectedGot("a tuple of length " + decoders.length, json) });
              }
          });
      };
      Decoder.union = function (ad, bd) {
          var decoders = [];
          for (var _i = 2; _i < arguments.length; _i++) {
              decoders[_i - 2] = arguments[_i];
          }
          return Decoder.oneOf.apply(Decoder, [ad, bd].concat(decoders));
      };
      Decoder.intersection = function (ad, bd) {
          var ds = [];
          for (var _i = 2; _i < arguments.length; _i++) {
              ds[_i - 2] = arguments[_i];
          }
          return new Decoder(function (json) {
              return [ad, bd].concat(ds).reduce(function (acc, decoder) { return map2(Object.assign, acc, decoder.decode(json)); }, ok({}));
          });
      };
      /**
       * Escape hatch to bypass validation. Always succeeds and types the result as
       * `any`. Useful for defining decoders incrementally, particularly for
       * complex objects.
       *
       * Example:
       * ```
       * interface User {
       *   name: string;
       *   complexUserData: ComplexType;
       * }
       *
       * const userDecoder: Decoder<User> = object({
       *   name: string(),
       *   complexUserData: anyJson()
       * });
       * ```
       */
      Decoder.anyJson = function () { return new Decoder(function (json) { return ok(json); }); };
      /**
       * Decoder identity function which always succeeds and types the result as
       * `unknown`.
       */
      Decoder.unknownJson = function () {
          return new Decoder(function (json) { return ok(json); });
      };
      /**
       * Decoder for json objects where the keys are unknown strings, but the values
       * should all be of the same type.
       *
       * Example:
       * ```
       * dict(number()).run({chocolate: 12, vanilla: 10, mint: 37});
       * // => {ok: true, result: {chocolate: 12, vanilla: 10, mint: 37}}
       * ```
       */
      Decoder.dict = function (decoder) {
          return new Decoder(function (json) {
              if (isJsonObject(json)) {
                  var obj = {};
                  for (var key in json) {
                      if (json.hasOwnProperty(key)) {
                          var r = decoder.decode(json[key]);
                          if (r.ok === true) {
                              obj[key] = r.result;
                          }
                          else {
                              return err(prependAt("." + key, r.error));
                          }
                      }
                  }
                  return ok(obj);
              }
              else {
                  return err({ message: expectedGot('an object', json) });
              }
          });
      };
      /**
       * Decoder for values that may be `undefined`. This is primarily helpful for
       * decoding interfaces with optional fields.
       *
       * Example:
       * ```
       * interface User {
       *   id: number;
       *   isOwner?: boolean;
       * }
       *
       * const decoder: Decoder<User> = object({
       *   id: number(),
       *   isOwner: optional(boolean())
       * });
       * ```
       */
      Decoder.optional = function (decoder) {
          return new Decoder(function (json) { return (json === undefined || json === null ? ok(undefined) : decoder.decode(json)); });
      };
      /**
       * Decoder that attempts to run each decoder in `decoders` and either succeeds
       * with the first successful decoder, or fails after all decoders have failed.
       *
       * Note that `oneOf` expects the decoders to all have the same return type,
       * while `union` creates a decoder for the union type of all the input
       * decoders.
       *
       * Examples:
       * ```
       * oneOf(string(), number().map(String))
       * oneOf(constant('start'), constant('stop'), succeed('unknown'))
       * ```
       */
      Decoder.oneOf = function () {
          var decoders = [];
          for (var _i = 0; _i < arguments.length; _i++) {
              decoders[_i] = arguments[_i];
          }
          return new Decoder(function (json) {
              var errors = [];
              for (var i = 0; i < decoders.length; i++) {
                  var r = decoders[i].decode(json);
                  if (r.ok === true) {
                      return r;
                  }
                  else {
                      errors[i] = r.error;
                  }
              }
              var errorsList = errors
                  .map(function (error) { return "at error" + (error.at || '') + ": " + error.message; })
                  .join('", "');
              return err({
                  message: "expected a value matching one of the decoders, got the errors [\"" + errorsList + "\"]"
              });
          });
      };
      /**
       * Decoder that always succeeds with either the decoded value, or a fallback
       * default value.
       */
      Decoder.withDefault = function (defaultValue, decoder) {
          return new Decoder(function (json) {
              return ok(withDefault(defaultValue, decoder.decode(json)));
          });
      };
      /**
       * Decoder that pulls a specific field out of a json structure, instead of
       * decoding and returning the full structure. The `paths` array describes the
       * object keys and array indices to traverse, so that values can be pulled out
       * of a nested structure.
       *
       * Example:
       * ```
       * const decoder = valueAt(['a', 'b', 0], string());
       *
       * decoder.run({a: {b: ['surprise!']}})
       * // => {ok: true, result: 'surprise!'}
       *
       * decoder.run({a: {x: 'cats'}})
       * // => {ok: false, error: {... at: 'input.a.b[0]' message: 'path does not exist'}}
       * ```
       *
       * Note that the `decoder` is ran on the value found at the last key in the
       * path, even if the last key is not found. This allows the `optional`
       * decoder to succeed when appropriate.
       * ```
       * const optionalDecoder = valueAt(['a', 'b', 'c'], optional(string()));
       *
       * optionalDecoder.run({a: {b: {c: 'surprise!'}}})
       * // => {ok: true, result: 'surprise!'}
       *
       * optionalDecoder.run({a: {b: 'cats'}})
       * // => {ok: false, error: {... at: 'input.a.b.c' message: 'expected an object, got "cats"'}
       *
       * optionalDecoder.run({a: {b: {z: 1}}})
       * // => {ok: true, result: undefined}
       * ```
       */
      Decoder.valueAt = function (paths, decoder) {
          return new Decoder(function (json) {
              var jsonAtPath = json;
              for (var i = 0; i < paths.length; i++) {
                  if (jsonAtPath === undefined) {
                      return err({
                          at: printPath(paths.slice(0, i + 1)),
                          message: 'path does not exist'
                      });
                  }
                  else if (typeof paths[i] === 'string' && !isJsonObject(jsonAtPath)) {
                      return err({
                          at: printPath(paths.slice(0, i + 1)),
                          message: expectedGot('an object', jsonAtPath)
                      });
                  }
                  else if (typeof paths[i] === 'number' && !isJsonArray(jsonAtPath)) {
                      return err({
                          at: printPath(paths.slice(0, i + 1)),
                          message: expectedGot('an array', jsonAtPath)
                      });
                  }
                  else {
                      jsonAtPath = jsonAtPath[paths[i]];
                  }
              }
              return mapError(function (error) {
                  return jsonAtPath === undefined
                      ? { at: printPath(paths), message: 'path does not exist' }
                      : prependAt(printPath(paths), error);
              }, decoder.decode(jsonAtPath));
          });
      };
      /**
       * Decoder that ignores the input json and always succeeds with `fixedValue`.
       */
      Decoder.succeed = function (fixedValue) {
          return new Decoder(function (json) { return ok(fixedValue); });
      };
      /**
       * Decoder that ignores the input json and always fails with `errorMessage`.
       */
      Decoder.fail = function (errorMessage) {
          return new Decoder(function (json) { return err({ message: errorMessage }); });
      };
      /**
       * Decoder that allows for validating recursive data structures. Unlike with
       * functions, decoders assigned to variables can't reference themselves
       * before they are fully defined. We can avoid prematurely referencing the
       * decoder by wrapping it in a function that won't be called until use, at
       * which point the decoder has been defined.
       *
       * Example:
       * ```
       * interface Comment {
       *   msg: string;
       *   replies: Comment[];
       * }
       *
       * const decoder: Decoder<Comment> = object({
       *   msg: string(),
       *   replies: lazy(() => array(decoder))
       * });
       * ```
       */
      Decoder.lazy = function (mkDecoder) {
          return new Decoder(function (json) { return mkDecoder().decode(json); });
      };
      return Decoder;
  }());

  /* tslint:disable:variable-name */
  /** See `Decoder.string` */
  var string = Decoder.string;
  /** See `Decoder.number` */
  var number = Decoder.number;
  /** See `Decoder.boolean` */
  var boolean = Decoder.boolean;
  /** See `Decoder.anyJson` */
  var anyJson = Decoder.anyJson;
  /** See `Decoder.unknownJson` */
  Decoder.unknownJson;
  /** See `Decoder.constant` */
  var constant = Decoder.constant;
  /** See `Decoder.object` */
  var object = Decoder.object;
  /** See `Decoder.array` */
  var array = Decoder.array;
  /** See `Decoder.tuple` */
  Decoder.tuple;
  /** See `Decoder.dict` */
  var dict = Decoder.dict;
  /** See `Decoder.optional` */
  var optional = Decoder.optional;
  /** See `Decoder.oneOf` */
  var oneOf = Decoder.oneOf;
  /** See `Decoder.union` */
  Decoder.union;
  /** See `Decoder.intersection` */
  Decoder.intersection;
  /** See `Decoder.withDefault` */
  Decoder.withDefault;
  /** See `Decoder.valueAt` */
  Decoder.valueAt;
  /** See `Decoder.succeed` */
  Decoder.succeed;
  /** See `Decoder.fail` */
  Decoder.fail;
  /** See `Decoder.lazy` */
  Decoder.lazy;

  const nonEmptyStringDecoder = string().where((s) => s.length > 0, "Expected a non-empty string");
  const nonNegativeNumberDecoder = number().where((num) => num >= 0, "Expected a non-negative number");

  const intentDefinitionDecoder = object({
      name: nonEmptyStringDecoder,
      displayName: optional(string()),
      contexts: optional(array(string())),
      customConfig: optional(object())
  });
  const v2TypeDecoder = oneOf(constant("web"), constant("native"), constant("citrix"), constant("onlineNative"), constant("other"));
  const v2DetailsDecoder = object({
      url: nonEmptyStringDecoder
  });
  const v2IconDecoder = object({
      src: nonEmptyStringDecoder,
      size: optional(nonEmptyStringDecoder),
      type: optional(nonEmptyStringDecoder)
  });
  const v2ScreenshotDecoder = object({
      src: nonEmptyStringDecoder,
      size: optional(nonEmptyStringDecoder),
      type: optional(nonEmptyStringDecoder),
      label: optional(nonEmptyStringDecoder)
  });
  const v2ListensForIntentDecoder = object({
      contexts: array(nonEmptyStringDecoder),
      displayName: optional(nonEmptyStringDecoder),
      resultType: optional(nonEmptyStringDecoder),
      customConfig: optional(anyJson())
  });
  const v2IntentsDecoder = object({
      listensFor: optional(dict(v2ListensForIntentDecoder)),
      raises: optional(dict(array(nonEmptyStringDecoder)))
  });
  const v2UserChannelDecoder = object({
      broadcasts: optional(array(nonEmptyStringDecoder)),
      listensFor: optional(array(nonEmptyStringDecoder))
  });
  const v2AppChannelDecoder = object({
      name: nonEmptyStringDecoder,
      description: optional(nonEmptyStringDecoder),
      broadcasts: optional(array(nonEmptyStringDecoder)),
      listensFor: optional(array(nonEmptyStringDecoder))
  });
  const v2InteropDecoder = object({
      intents: optional(v2IntentsDecoder),
      userChannels: optional(v2UserChannelDecoder),
      appChannels: optional(array(v2AppChannelDecoder))
  });
  const glue42ApplicationDetailsDecoder = object({
      url: optional(nonEmptyStringDecoder),
      top: optional(number()),
      left: optional(number()),
      width: optional(nonNegativeNumberDecoder),
      height: optional(nonNegativeNumberDecoder)
  });
  const glue42HostManifestsBrowserDecoder = object({
      name: optional(nonEmptyStringDecoder),
      type: optional(nonEmptyStringDecoder.where((s) => s === "window", "Expected a value of window")),
      title: optional(nonEmptyStringDecoder),
      version: optional(nonEmptyStringDecoder),
      customProperties: optional(anyJson()),
      icon: optional(string()),
      caption: optional(string()),
      details: optional(glue42ApplicationDetailsDecoder),
      intents: optional(array(intentDefinitionDecoder)),
      hidden: optional(boolean())
  });
  const v1DefinitionDecoder = object({
      name: nonEmptyStringDecoder,
      appId: nonEmptyStringDecoder,
      title: optional(nonEmptyStringDecoder),
      version: optional(nonEmptyStringDecoder),
      manifest: nonEmptyStringDecoder,
      manifestType: nonEmptyStringDecoder,
      tooltip: optional(nonEmptyStringDecoder),
      description: optional(nonEmptyStringDecoder),
      contactEmail: optional(nonEmptyStringDecoder),
      supportEmail: optional(nonEmptyStringDecoder),
      publisher: optional(nonEmptyStringDecoder),
      images: optional(array(object({ url: optional(nonEmptyStringDecoder) }))),
      icons: optional(array(object({ icon: optional(nonEmptyStringDecoder) }))),
      customConfig: anyJson(),
      intents: optional(array(intentDefinitionDecoder))
  });
  const v2LocalizedDefinitionDecoder = object({
      appId: optional(nonEmptyStringDecoder),
      name: optional(nonEmptyStringDecoder),
      details: optional(v2DetailsDecoder),
      version: optional(nonEmptyStringDecoder),
      title: optional(nonEmptyStringDecoder),
      tooltip: optional(nonEmptyStringDecoder),
      lang: optional(nonEmptyStringDecoder),
      description: optional(nonEmptyStringDecoder),
      categories: optional(array(nonEmptyStringDecoder)),
      icons: optional(array(v2IconDecoder)),
      screenshots: optional(array(v2ScreenshotDecoder)),
      contactEmail: optional(nonEmptyStringDecoder),
      supportEmail: optional(nonEmptyStringDecoder),
      moreInfo: optional(nonEmptyStringDecoder),
      publisher: optional(nonEmptyStringDecoder),
      customConfig: optional(array(anyJson())),
      hostManifests: optional(anyJson()),
      interop: optional(v2InteropDecoder)
  });
  const v2DefinitionDecoder = object({
      appId: nonEmptyStringDecoder,
      name: nonEmptyStringDecoder,
      type: v2TypeDecoder,
      details: v2DetailsDecoder,
      version: optional(nonEmptyStringDecoder),
      title: optional(nonEmptyStringDecoder),
      tooltip: optional(nonEmptyStringDecoder),
      lang: optional(nonEmptyStringDecoder),
      description: optional(nonEmptyStringDecoder),
      categories: optional(array(nonEmptyStringDecoder)),
      icons: optional(array(v2IconDecoder)),
      screenshots: optional(array(v2ScreenshotDecoder)),
      contactEmail: optional(nonEmptyStringDecoder),
      supportEmail: optional(nonEmptyStringDecoder),
      moreInfo: optional(nonEmptyStringDecoder),
      publisher: optional(nonEmptyStringDecoder),
      customConfig: optional(array(anyJson())),
      hostManifests: optional(anyJson()),
      interop: optional(v2InteropDecoder),
      localizedVersions: optional(dict(v2LocalizedDefinitionDecoder))
  });
  const allDefinitionsDecoder = oneOf(v1DefinitionDecoder, v2DefinitionDecoder);

  const parseDecoderErrorToStringMessage = (error) => {
      return `${error.kind} at ${error.at}: ${JSON.stringify(error.input)}. Reason - ${error.message}`;
  };

  class FDC3Service {
      fdc3ToDesktopDefinitionType = {
          web: "window",
          native: "exe",
          citrix: "citrix",
          onlineNative: "clickonce",
          other: "window"
      };
      toApi() {
          return {
              isFdc3Definition: this.isFdc3Definition.bind(this),
              parseToBrowserBaseAppData: this.parseToBrowserBaseAppData.bind(this),
              parseToDesktopAppConfig: this.parseToDesktopAppConfig.bind(this)
          };
      }
      isFdc3Definition(definition) {
          const decodeRes = allDefinitionsDecoder.run(definition);
          if (!decodeRes.ok) {
              return { isFdc3: false, reason: parseDecoderErrorToStringMessage(decodeRes.error) };
          }
          if (definition.appId && definition.details) {
              return { isFdc3: true, version: "2.0" };
          }
          if (definition.manifest) {
              return { isFdc3: true, version: "1.2" };
          }
          return { isFdc3: false, reason: "The passed definition is not FDC3" };
      }
      parseToBrowserBaseAppData(definition) {
          const { isFdc3, version } = this.isFdc3Definition(definition);
          if (!isFdc3) {
              throw new Error("The passed definition is not FDC3");
          }
          const decodeRes = allDefinitionsDecoder.run(definition);
          if (!decodeRes.ok) {
              throw new Error(`Invalid FDC3 ${version} definition. Error: ${parseDecoderErrorToStringMessage(decodeRes.error)}`);
          }
          const userProperties = this.getUserPropertiesFromDefinition(definition, version);
          const createOptions = { url: this.getUrl(definition, version) };
          const baseApplicationData = {
              name: definition.appId,
              type: "window",
              createOptions,
              userProperties: {
                  ...userProperties,
                  intents: version === "1.2"
                      ? userProperties.intents
                      : this.getIntentsFromV2AppDefinition(definition),
                  details: createOptions
              },
              title: definition.title,
              version: definition.version,
              icon: this.getIconFromDefinition(definition, version),
              caption: definition.description,
              fdc3: version === "2.0" ? { ...definition, definitionVersion: "2.0" } : undefined,
          };
          const ioConnectDefinition = definition.hostManifests?.ioConnect || definition.hostManifests?.["Glue42"];
          if (!ioConnectDefinition) {
              return baseApplicationData;
          }
          const ioDefinitionDecodeRes = glue42HostManifestsBrowserDecoder.run(ioConnectDefinition);
          if (!ioDefinitionDecodeRes.ok) {
              throw new Error(`Invalid FDC3 ${version} definition. Error: ${parseDecoderErrorToStringMessage(ioDefinitionDecodeRes.error)}`);
          }
          if (!Object.keys(ioDefinitionDecodeRes.result).length) {
              return baseApplicationData;
          }
          return this.mergeBaseAppDataWithGlueManifest(baseApplicationData, ioDefinitionDecodeRes.result);
      }
      parseToDesktopAppConfig(definition) {
          const { isFdc3, version } = this.isFdc3Definition(definition);
          if (!isFdc3) {
              throw new Error("The passed definition is not FDC3");
          }
          const decodeRes = allDefinitionsDecoder.run(definition);
          if (!decodeRes.ok) {
              throw new Error(`Invalid FDC3 ${version} definition. Error: ${parseDecoderErrorToStringMessage(decodeRes.error)}`);
          }
          if (version === "1.2") {
              const fdc3v1Definition = definition;
              return {
                  name: fdc3v1Definition.appId,
                  type: "window",
                  details: {
                      url: this.getUrl(definition, version)
                  },
                  version: fdc3v1Definition.version,
                  title: fdc3v1Definition.title,
                  tooltip: fdc3v1Definition.tooltip,
                  caption: fdc3v1Definition.description,
                  icon: fdc3v1Definition.icons?.[0].icon,
                  intents: fdc3v1Definition.intents,
                  customProperties: {
                      manifestType: fdc3v1Definition.manifestType,
                      images: fdc3v1Definition.images,
                      contactEmail: fdc3v1Definition.contactEmail,
                      supportEmail: fdc3v1Definition.supportEmail,
                      publisher: fdc3v1Definition.publisher,
                      icons: fdc3v1Definition.icons,
                      customConfig: fdc3v1Definition.customConfig
                  }
              };
          }
          const fdc3v2Definition = definition;
          const desktopDefinition = {
              name: fdc3v2Definition.appId,
              type: this.fdc3ToDesktopDefinitionType[fdc3v2Definition.type],
              details: fdc3v2Definition.details,
              version: fdc3v2Definition.version,
              title: fdc3v2Definition.title,
              tooltip: fdc3v2Definition.tooltip,
              caption: fdc3v2Definition.description,
              icon: this.getIconFromDefinition(fdc3v2Definition, "2.0"),
              intents: this.getIntentsFromV2AppDefinition(fdc3v2Definition),
              fdc3: { ...fdc3v2Definition, definitionVersion: "2.0" }
          };
          const ioConnectDefinition = definition.hostManifests?.ioConnect || definition.hostManifests?.["Glue42"];
          if (!ioConnectDefinition) {
              return desktopDefinition;
          }
          if (typeof ioConnectDefinition !== "object" || Array.isArray(ioConnectDefinition)) {
              throw new Error(`Invalid '${definition.hostManifests.ioConnect ? "hostManifests.ioConnect" : "hostManifests['Glue42']"}' key`);
          }
          return this.mergeDesktopConfigWithGlueManifest(desktopDefinition, ioConnectDefinition);
      }
      getUserPropertiesFromDefinition(definition, version) {
          if (version === "1.2") {
              return Object.fromEntries(Object.entries(definition).filter(([key]) => !connectBrowserAppProps.includes(key)));
          }
          return Object.fromEntries(Object.entries(definition).filter(([key]) => !connectBrowserAppProps.includes(key) && !fdc3v2AppProps.includes(key)));
      }
      getUrl(definition, version) {
          let url;
          if (version === "1.2") {
              const parsedManifest = JSON.parse(definition.manifest);
              url = parsedManifest.details?.url || parsedManifest.url;
          }
          else {
              url = definition.details?.url;
          }
          if (!url || typeof url !== "string") {
              throw new Error(`Invalid FDC3 ${version} definition. Provide valid 'url' under '${version === "1.2" ? "manifest" : "details"}' key`);
          }
          return url;
      }
      getIntentsFromV2AppDefinition(definition) {
          const fdc3Intents = definition.interop?.intents?.listensFor;
          if (!fdc3Intents) {
              return;
          }
          const intents = Object.entries(fdc3Intents).map((fdc3Intent) => {
              const [intentName, intentData] = fdc3Intent;
              return {
                  name: intentName,
                  ...intentData
              };
          });
          return intents;
      }
      getIconFromDefinition(definition, version) {
          if (version === "1.2") {
              return definition.icons?.find((iconDef) => iconDef.icon)?.icon || undefined;
          }
          return definition.icons?.find((iconDef) => iconDef.src)?.src || undefined;
      }
      mergeBaseAppDataWithGlueManifest(baseAppData, hostManifestDefinition) {
          let baseApplicationDefinition = baseAppData;
          if (hostManifestDefinition.details) {
              const details = { ...baseAppData.createOptions, ...hostManifestDefinition.details };
              baseApplicationDefinition.createOptions = details;
              baseApplicationDefinition.userProperties.details = details;
          }
          if (Array.isArray(hostManifestDefinition.intents)) {
              baseApplicationDefinition.userProperties.intents = (baseApplicationDefinition.userProperties.intents || []).concat(hostManifestDefinition.intents);
          }
          baseApplicationDefinition = { ...baseApplicationDefinition, ...hostManifestDefinition };
          delete baseApplicationDefinition.details;
          delete baseApplicationDefinition.intents;
          return baseApplicationDefinition;
      }
      mergeDesktopConfigWithGlueManifest(config, desktopDefinition) {
          const appConfig = Object.assign({}, config, desktopDefinition, { details: { ...config.details, ...desktopDefinition.details } });
          if (Array.isArray(desktopDefinition.intents)) {
              appConfig.intents = (config.intents || []).concat(desktopDefinition.intents);
          }
          return appConfig;
      }
  }

  const decoders$1 = {
      common: {
          nonEmptyStringDecoder,
          nonNegativeNumberDecoder
      },
      fdc3: {
          allDefinitionsDecoder,
          v1DefinitionDecoder,
          v2DefinitionDecoder
      }
  };

  var INTENTS_ERRORS;
  (function (INTENTS_ERRORS) {
      INTENTS_ERRORS["USER_CANCELLED"] = "User Closed Intents Resolver UI without choosing a handler";
      INTENTS_ERRORS["CALLER_NOT_DEFINED"] = "Caller Id is not defined";
      INTENTS_ERRORS["TIMEOUT_HIT"] = "Timeout hit";
      INTENTS_ERRORS["INTENT_NOT_FOUND"] = "Cannot find Intent";
      INTENTS_ERRORS["HANDLER_NOT_FOUND"] = "Cannot find Intent Handler";
      INTENTS_ERRORS["TARGET_INSTANCE_UNAVAILABLE"] = "Cannot start Target Instance";
      INTENTS_ERRORS["INTENT_DELIVERY_FAILED"] = "Target Instance did not add a listener";
      INTENTS_ERRORS["RESOLVER_UNAVAILABLE"] = "Intents Resolver UI unavailable";
      INTENTS_ERRORS["RESOLVER_TIMEOUT"] = "User did not choose a handler";
      INTENTS_ERRORS["INVALID_RESOLVER_RESPONSE"] = "Intents Resolver UI returned invalid response";
      INTENTS_ERRORS["INTENT_HANDLER_REJECTION"] = "Intent Handler function processing the raised intent threw an error or rejected the promise it returned";
  })(INTENTS_ERRORS || (INTENTS_ERRORS = {}));

  class IoC {
      _fdc3;
      _decoders = decoders$1;
      _errors = {
          intents: INTENTS_ERRORS
      };
      get fdc3() {
          if (!this._fdc3) {
              this._fdc3 = new FDC3Service().toApi();
          }
          return this._fdc3;
      }
      get decoders() {
          return this._decoders;
      }
      get errors() {
          return this._errors;
      }
  }

  const ioc = new IoC();
  ioc.fdc3;
  ioc.decoders;
  const errors = ioc.errors;

  const GLUE42_FDC3_INTENTS_METHOD_PREFIX = "Tick42.FDC3.Intents.";
  const INTENTS_RESOLVER_INTEROP_PREFIX = "T42.Intents.Resolver.Control";
  const INTENTS_RESOLVER_WIDTH = 400;
  const INTENTS_RESOLVER_HEIGHT = 440;
  const DEFAULT_RESOLVER_RESPONSE_TIMEOUT = 60 * 1000;
  const INTENT_HANDLER_DEFAULT_PROPS = ["applicationName", "type"];
  const INTENTS_RESOLVER_APP_NAME = "intentsResolver";
  const MAX_SET_TIMEOUT_DELAY = 2147483647;
  const DEFAULT_METHOD_RESPONSE_TIMEOUT_MS = 60 * 1000;
  const DEFAULT_RAISE_TIMEOUT_MS = 90 * 1000;
  const DEFAULT_PICK_HANDLER_BY_TIMEOUT_MS = 90 * 1000;
  const ERRORS = errors.intents;

  const PromisePlus = (executor, timeoutMilliseconds, timeoutMessage) => {
      return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
              const message = timeoutMessage || `Promise timeout hit: ${timeoutMilliseconds}`;
              reject(message);
          }, timeoutMilliseconds);
          const providedPromise = new Promise(executor);
          providedPromise
              .then((result) => {
              clearTimeout(timeout);
              resolve(result);
          })
              .catch((error) => {
              clearTimeout(timeout);
              reject(error);
          });
      });
  };
  const PromiseWrap = (promise, timeoutMilliseconds, timeoutMessage) => {
      return new Promise((resolve, reject) => {
          let promiseActive = true;
          const timeout = setTimeout(() => {
              if (!promiseActive) {
                  return;
              }
              promiseActive = false;
              const message = timeoutMessage || `Promise timeout hit: ${timeoutMilliseconds}`;
              reject(message);
          }, timeoutMilliseconds);
          promise()
              .then((result) => {
              if (!promiseActive) {
                  return;
              }
              promiseActive = false;
              clearTimeout(timeout);
              resolve(result);
          })
              .catch((error) => {
              if (!promiseActive) {
                  return;
              }
              promiseActive = false;
              clearTimeout(timeout);
              reject(error);
          });
      });
  };

  const validateIntentHandlerAsResponse = (handler) => {
      if (typeof handler !== "object") {
          return { isValid: false, error: `Response object has invalid 'handler' key. Expected an object, got ${typeof handler}` };
      }
      const compulsoryKeysExist = INTENT_HANDLER_DEFAULT_PROPS.filter((key) => !(key in handler));
      if (compulsoryKeysExist.length) {
          return { isValid: false, error: `Handler in Response object does not provide compulsory keys: ${compulsoryKeysExist.join(", ")}` };
      }
      return { isValid: true, ok: handler };
  };
  const validateIntentRequestTarget = (target) => {
      if (!target) {
          return;
      }
      if (typeof target !== "string" && typeof target !== "object") {
          throw new Error(`Please provide the intent target as one of the valid values: "reuse", "startNew", { app: string }, { instance: string } `);
      }
  };
  const validateIntentRequestContext = (context) => {
      if (!context) {
          return;
      }
      if (typeof context !== "object") {
          throw new Error(`Please provide the intent context as an object`);
      }
      if (context.type && typeof context.type !== "string") {
          throw new Error(`Please provide the intent context as an object with 'type' property as string`);
      }
      if (context.data && typeof context.data !== "object") {
          throw new Error(`Please provide the intent context as an object with 'data' property as object`);
      }
  };
  const validateIntentRequestHandler = (handler) => {
      if (!handler.applicationName) {
          throw new Error(`Please provide applicationName for handler ${JSON.stringify(handler)}`);
      }
      if (!handler.type) {
          throw new Error(`Please provide type for handler ${JSON.stringify(handler)}`);
      }
      if (handler.type === "instance" && !handler.instanceId) {
          throw new Error(`Please provide instanceId for handler ${JSON.stringify(handler)}`);
      }
  };
  const validateIntentRequestTimeout = (timeout) => {
      if (!timeout) {
          return;
      }
      if (typeof timeout !== "number") {
          throw new Error(`Please provide the timeout as a number`);
      }
      if (timeout <= 0) {
          throw new Error(`Please provide the timeout as a positive number`);
      }
  };
  const validateWaitUserResponseIndefinitely = (waitUserResponseIndefinitely) => {
      if (!waitUserResponseIndefinitely) {
          return;
      }
      if (typeof waitUserResponseIndefinitely !== "boolean") {
          throw new Error("Please provide waitUserResponseIndefinitely as a boolean");
      }
  };
  const validateHandlerFilter = (handlerFilter) => {
      if (!handlerFilter) {
          throw new Error(`Provide 'handlerFilter' with at least one filter criteria of the following: 'intent' | 'contextTypes' | 'resultType' | 'applicationNames'`);
      }
      const { title, openResolver, timeout, intent, contextTypes, resultType, applicationNames } = handlerFilter;
      if (typeof title !== "undefined" && (typeof title !== "string" || !title.length)) {
          throw new Error(`Provide 'title' as a non empty string`);
      }
      if (typeof openResolver !== "undefined" && typeof openResolver !== "boolean") {
          throw new Error(`Provide 'openResolver' prop as a boolean`);
      }
      if (typeof timeout !== "undefined" && (typeof timeout !== "number" || timeout <= 0)) {
          throw new Error(`Provide 'timeout' prop as a positive number`);
      }
      if (typeof intent !== "undefined" && (typeof intent !== "string" || !intent.length)) {
          throw new Error(`Provide 'intent' as a non empty string`);
      }
      if (typeof contextTypes !== "undefined" && (!Array.isArray(contextTypes) || contextTypes.some(ctx => typeof ctx !== "string"))) {
          throw new Error(`Provide 'contextTypes' as an array of non empty strings`);
      }
      if (typeof resultType !== "undefined" && (typeof resultType !== "string" || !resultType.length)) {
          throw new Error(`Provide 'resultType' as a non empty string`);
      }
      if (typeof applicationNames !== "undefined" && (!Array.isArray(applicationNames) || applicationNames.some(appName => typeof appName !== "string"))) {
          throw new Error(`Provide 'applicationNames' as an array of non empty strings`);
      }
      const errorMsg = "Provide at least one filter criteria of the following: 'intent' | 'contextTypes' | 'resultType' | 'applicationNames'";
      if (!Object.keys(handlerFilter).length) {
          throw new Error(errorMsg);
      }
      if (!intent && !resultType && (!contextTypes || !contextTypes.length) && (!applicationNames || !applicationNames.length)) {
          throw new Error(errorMsg);
      }
  };
  const validateResolverResponse = (responseObj) => {
      var _a, _b;
      if (typeof responseObj.intent !== "string") {
          return { isValid: false, error: `Response object has invalid 'intent' key. Expected a string, got ${typeof responseObj.intent}` };
      }
      if (((_a = responseObj.userSettings) === null || _a === void 0 ? void 0 : _a.preserveChoice) && typeof ((_b = responseObj.userSettings) === null || _b === void 0 ? void 0 : _b.preserveChoice) !== "boolean") {
          return { isValid: false, error: `Response object has invalid 'userSettings.preserveChoice' key. Expected a boolean, got ${typeof responseObj.userSettings.preserveChoice}` };
      }
      const { isValid, error } = validateIntentHandlerAsResponse(responseObj.handler);
      return isValid
          ? { isValid: true, ok: responseObj }
          : { isValid, error };
  };
  const validateIntentRequest = (request) => {
      validateIntentRequestContext(request.context);
      validateIntentRequestTarget(request.target);
      validateIntentRequestTimeout(request.timeout);
      validateWaitUserResponseIndefinitely(request.waitUserResponseIndefinitely);
      if (typeof request.clearSavedHandler !== "undefined" && typeof request.clearSavedHandler !== "boolean") {
          throw new Error("Please provide 'clearSavedHandler' as a boolean");
      }
      if (request.handlers) {
          request.handlers.forEach((handler) => validateIntentRequestHandler(handler));
      }
  };
  const validateIntentHandler = (handler) => {
      if (typeof handler !== "object") {
          throw new Error("IntentHandler must be an object");
      }
      if (typeof handler.applicationName !== "string" || !handler.applicationName.length) {
          throw new Error(`Please provide 'applicationName' as a non-empty string`);
      }
      if (typeof handler.type !== "string" || !["app", "instance"].includes(handler.type)) {
          throw new Error(`Invalid 'type' property. Expected 'app' | 'instance' got ${handler.type}`);
      }
      if (typeof handler.applicationTitle !== "undefined" && typeof handler.applicationTitle !== "string") {
          throw new Error(`Provide 'applicationTitle' as a string`);
      }
      if (typeof handler.applicationDescription !== "undefined" && typeof handler.applicationDescription !== "string") {
          throw new Error(`Provide 'applicationDescription' as a string`);
      }
      if (typeof handler.applicationIcon !== "undefined" && typeof handler.applicationIcon !== "string") {
          throw new Error(`Provide 'applicationIcon' as a string`);
      }
      if (typeof handler.displayName !== "undefined" && typeof handler.displayName !== "string") {
          throw new Error(`Provide 'displayName' as a string`);
      }
      if (typeof handler.contextTypes !== "undefined" && (!Array.isArray(handler.contextTypes) || handler.contextTypes.some(ctx => typeof ctx !== "string"))) {
          throw new Error(`Provide 'contextTypes' as an array of non empty strings`);
      }
      if (typeof handler.instanceId !== "undefined" && typeof handler.instanceId !== "string") {
          throw new Error(`Provide 'instanceId' as a string`);
      }
      if (typeof handler.instanceTitle !== "undefined" && typeof handler.instanceTitle !== "string") {
          throw new Error(`Provide 'instanceTitle' as a string`);
      }
      if (typeof handler.resultType !== "undefined" && typeof handler.resultType !== "string") {
          throw new Error(`Provide 'resultType' as a string`);
      }
  };
  const clearNullUndefined = (obj) => {
      Object.keys(obj).forEach(key => {
          if (obj[key] === null || obj[key] === undefined) {
              delete obj[key];
          }
      });
  };

  class Intents {
      constructor(interop, windows, logger, options, prefsController, appManager) {
          this.interop = interop;
          this.windows = windows;
          this.logger = logger;
          this.prefsController = prefsController;
          this.appManager = appManager;
          this.myIntents = new Set();
          this.intentsResolverResponsePromises = {};
          this.useIntentsResolverUI = true;
          this.unregisterIntentPromises = [];
          this.addedHandlerInfoPerApp = {};
          this.checkIfIntentsResolverIsEnabled(options, appManager);
      }
      async find(intentFilter) {
          await Promise.all(this.unregisterIntentPromises);
          let intents = await this.all();
          if (typeof intentFilter === "undefined") {
              return intents;
          }
          if (typeof intentFilter === "string") {
              return intents.filter((intent) => intent.name === intentFilter);
          }
          if (typeof intentFilter !== "object") {
              throw new Error("Please provide the intentFilter as a string or an object!");
          }
          if (intentFilter.contextType) {
              const ctToLower = intentFilter.contextType.toLowerCase();
              intents = intents.filter((intent) => intent.handlers.some((handler) => { var _a; return (_a = handler.contextTypes) === null || _a === void 0 ? void 0 : _a.some((ct) => ct.toLowerCase() === ctToLower); }));
          }
          if (intentFilter.resultType) {
              const resultTypeToLower = intentFilter.resultType.toLowerCase();
              intents = intents.filter((intent) => intent.handlers.some((handler) => { var _a; return ((_a = handler.resultType) === null || _a === void 0 ? void 0 : _a.toLowerCase()) === resultTypeToLower; }));
          }
          if (intentFilter.name) {
              intents = intents.filter((intent) => intent.name === intentFilter.name);
          }
          return intents;
      }
      async raise(intentRequest) {
          if ((typeof intentRequest !== "string" && typeof intentRequest !== "object") || (typeof intentRequest === "object" && typeof intentRequest.intent !== "string")) {
              throw new Error("Please provide the intent as a string or an object with an intent property!");
          }
          if (typeof intentRequest === "string") {
              intentRequest = { intent: intentRequest };
          }
          validateIntentRequest(intentRequest);
          await Promise.all(this.unregisterIntentPromises);
          if (intentRequest.clearSavedHandler) {
              this.logger.trace(`User removes saved handler for intent ${intentRequest.intent}`);
              await this.removeRememberedHandler(intentRequest.intent);
          }
          const resolverInstance = {};
          const timeout = intentRequest.waitUserResponseIndefinitely ? MAX_SET_TIMEOUT_DELAY : intentRequest.timeout || DEFAULT_RAISE_TIMEOUT_MS;
          const resultFromRememberedHandler = await this.checkHandleRaiseWithRememberedHandler(intentRequest, resolverInstance, timeout);
          if (resultFromRememberedHandler) {
              return resultFromRememberedHandler;
          }
          const coreRaiseIntentFn = this.coreRaiseIntent.bind(this, { request: intentRequest, resolverInstance, timeout });
          if (intentRequest.waitUserResponseIndefinitely) {
              return coreRaiseIntentFn();
          }
          const resultPromise = PromiseWrap(coreRaiseIntentFn, timeout, `${ERRORS.TIMEOUT_HIT} hit for intent request ${JSON.stringify(intentRequest)}`);
          resultPromise.catch(() => this.handleRaiseOnError(resolverInstance.instanceId));
          return resultPromise;
      }
      async all() {
          await Promise.all(this.unregisterIntentPromises);
          let apps;
          try {
              const result = await this.interop.invoke("T42.ACS.GetApplications", { withIntentsInfo: true }, "best", {
                  waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
                  methodResponseTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS
              });
              apps = result.returned.applications;
          }
          catch (e) {
              this.logger.error(`Failed to get the applications!`, e);
              return [];
          }
          const intents = {};
          const appsWithIntents = apps.filter((app) => app.intents && app.intents.length > 0);
          for (const app of appsWithIntents) {
              for (const intentDef of app.intents) {
                  let intent = intents[intentDef.name];
                  if (!intent) {
                      intent = {
                          name: intentDef.name,
                          handlers: [],
                      };
                      intents[intentDef.name] = intent;
                  }
                  const handler = {
                      applicationName: app.name,
                      applicationTitle: app.title || "",
                      applicationDescription: app.caption,
                      displayName: intentDef.displayName,
                      contextTypes: intentDef.contexts,
                      applicationIcon: app.icon,
                      type: "app",
                      resultType: intentDef.resultType
                  };
                  intent.handlers.push(handler);
              }
          }
          const servers = this.interop.servers();
          const serverWindowIds = servers.map((server) => server.windowId).filter((serverWindowId) => typeof serverWindowId !== "undefined");
          const T42WndGetInfo = "T42.Wnd.GetInfo";
          const isT42WndGetInfoMethodRegistered = this.interop.methods().some((method) => method.name === T42WndGetInfo);
          let windowsInfos;
          if (isT42WndGetInfoMethodRegistered) {
              try {
                  const result = await this.interop.invoke(T42WndGetInfo, { ids: serverWindowIds }, "best", {
                      waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
                      methodResponseTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS
                  });
                  windowsInfos = result.returned.windows;
              }
              catch (e) {
              }
          }
          for (const server of servers) {
              await Promise.all(server.getMethods()
                  .filter((method) => method.name.startsWith(GLUE42_FDC3_INTENTS_METHOD_PREFIX))
                  .map(async (method) => {
                  const intentName = method.name.replace(GLUE42_FDC3_INTENTS_METHOD_PREFIX, "");
                  let intent = intents[intentName];
                  if (!intent) {
                      intent = {
                          name: intentName,
                          handlers: [],
                      };
                      intents[intentName] = intent;
                  }
                  const title = await this.windowsIdToTitle(server.windowId, windowsInfos);
                  const handler = this.constructIntentHandler({ method, apps, server, intentName, title });
                  intent.handlers.push(handler);
              }));
          }
          return Object.values(intents);
      }
      addIntentListener(intent, handler) {
          if ((typeof intent !== "string" && typeof intent !== "object") || (typeof intent === "object" && typeof intent.intent !== "string")) {
              throw new Error("Please provide the intent as a string or an object with an intent property!");
          }
          if (typeof handler !== "function") {
              throw new Error("Please provide the handler as a function!");
          }
          const intentName = typeof intent === "string" ? intent : intent.intent;
          const methodName = `${GLUE42_FDC3_INTENTS_METHOD_PREFIX}${intentName}`;
          let intentFlag = {};
          let registerPromise;
          const alreadyRegistered = this.myIntents.has(intentName);
          if (alreadyRegistered) {
              throw new Error(`Intent listener for intent ${intentName} already registered!`);
          }
          this.myIntents.add(intentName);
          const result = {
              unsubscribe: () => {
                  this.myIntents.delete(intentName);
                  registerPromise
                      .then(() => this.interop.unregister(methodName))
                      .catch((err) => this.logger.trace(`Unregistration of a method with name ${methodName} failed with reason: ${JSON.stringify(err)}`));
              }
          };
          if (typeof intent === "object") {
              const { intent: removed, ...rest } = intent;
              intentFlag = rest;
          }
          registerPromise = this.interop.register({ name: methodName, flags: { intent: intentFlag } }, (args) => {
              if (this.myIntents.has(intentName)) {
                  return handler(args);
              }
          });
          registerPromise.catch((err) => {
              this.myIntents.delete(intentName);
              this.logger.warn(`Registration of a method with name ${methodName} failed with reason: ${JSON.stringify(err)}`);
          });
          return result;
      }
      async register(intent, handler) {
          if ((typeof intent !== "string" && typeof intent !== "object") || (typeof intent === "object" && typeof intent.intent !== "string")) {
              throw new Error("Please provide the intent as a string or an object with an intent property!");
          }
          if (typeof handler !== "function") {
              throw new Error("Please provide the handler as a function!");
          }
          await Promise.all(this.unregisterIntentPromises);
          const intentName = typeof intent === "string" ? intent : intent.intent;
          const methodName = this.buildInteropMethodName(intentName);
          let intentFlag = {};
          const alreadyRegistered = this.myIntents.has(intentName);
          if (alreadyRegistered) {
              throw new Error(`Intent listener for intent ${intentName} already registered!`);
          }
          this.myIntents.add(intentName);
          if (typeof intent === "object") {
              const { intent: removed, ...rest } = intent;
              intentFlag = rest;
          }
          try {
              await this.interop.register({ name: methodName, flags: { intent: intentFlag } }, (args, caller) => {
                  if (this.myIntents.has(intentName)) {
                      return handler(args, caller);
                  }
              });
          }
          catch (err) {
              this.myIntents.delete(intentName);
              throw new Error(`Registration of a method with name ${methodName} failed with reason: ${JSON.stringify(err)}`);
          }
          return {
              unsubscribe: () => this.unsubscribeIntent(intentName)
          };
      }
      async filterHandlers(handlerFilter) {
          var _a, _b;
          validateHandlerFilter(handlerFilter);
          if (handlerFilter.openResolver && !this.useIntentsResolverUI) {
              throw new Error("Cannot resolve 'filterHandlers' request using Intents Resolver UI because it's globally disabled");
          }
          (_a = this.logger) === null || _a === void 0 ? void 0 : _a.trace(`Received 'filterHandlers' command with request: ${JSON.stringify(handlerFilter)}`);
          const filteredHandlers = this.filterHandlersBy(await this.all(), handlerFilter);
          if (!filteredHandlers || !filteredHandlers.length) {
              return { handlers: [] };
          }
          const { open, reason } = this.checkIfResolverShouldBeOpenedForFilterHandlers(filteredHandlers, handlerFilter);
          if (!open) {
              (_b = this.logger) === null || _b === void 0 ? void 0 : _b.trace(`Intent Resolver UI won't be used. Reason: ${reason}`);
              return { handlers: filteredHandlers };
          }
          const resolverInstance = { instanceId: undefined };
          const timeout = handlerFilter.timeout || DEFAULT_PICK_HANDLER_BY_TIMEOUT_MS;
          const handler = await PromiseWrap(() => this.startResolverApp({ request: handlerFilter, resolverInstance, method: 'filterHandlers' }), timeout, `Timeout of ${timeout}ms hit for 'filterHandlers' request with filter: ${JSON.stringify(handlerFilter)}`);
          return { handlers: [handler] };
      }
      async getIntents(handler) {
          var _a;
          this.logger.trace(`Received 'getIntents' command with handler ${JSON.stringify(handler)}`);
          validateIntentHandler(handler);
          const intents = await this.all();
          clearNullUndefined(handler);
          (_a = this.logger) === null || _a === void 0 ? void 0 : _a.trace(`Extracting valid intents for the passed handler`);
          const intentsWithInfo = this.extractIntentsWithInfoByHandler(intents, handler);
          this.logger.trace(`Returning intents for handler ${JSON.stringify(handler)}`);
          return { intents: intentsWithInfo };
      }
      async clearSavedHandlers() {
          this.logger.trace("Removing all saved handlers from prefs storage for current app");
          await this.prefsController.update({ intents: undefined });
      }
      onHandlerAdded(callback) {
          var _a;
          const unAppAdded = (_a = this.appManager) === null || _a === void 0 ? void 0 : _a.onAppAdded(async (app) => {
              var _a;
              const appName = app.name;
              const appDef = await app.getConfiguration();
              const isIntentHandler = (_a = appDef === null || appDef === void 0 ? void 0 : appDef.intents) === null || _a === void 0 ? void 0 : _a.length;
              if (!isIntentHandler) {
                  return;
              }
              appDef.intents.forEach((intent) => {
                  const handler = this.constructIntentHandlerFromApp(appDef, intent);
                  if (!this.addedHandlerInfoPerApp[appName]) {
                      this.addedHandlerInfoPerApp[appName] = [];
                  }
                  const appHandlers = this.addedHandlerInfoPerApp[appName];
                  appHandlers.push({ handler, name: intent.name });
                  callback(handler, intent.name);
              });
          });
          const unServerMethodAdded = this.interop.serverMethodAdded(({ method, server }) => {
              if (!method.name.startsWith(GLUE42_FDC3_INTENTS_METHOD_PREFIX)) {
                  return;
              }
              const intentName = method.name.replace(GLUE42_FDC3_INTENTS_METHOD_PREFIX, "");
              const intentsInfo = this.constructIntentHandler({ method, apps: [], server, intentName, title: "" });
              callback(intentsInfo, intentName);
          });
          return () => {
              if (typeof unServerMethodAdded === "function") {
                  unServerMethodAdded();
              }
              if (typeof unAppAdded === "function") {
                  unAppAdded();
              }
          };
      }
      onHandlerRemoved(callback) {
          var _a;
          const unAppRemoved = (_a = this.appManager) === null || _a === void 0 ? void 0 : _a.onAppRemoved(async (app) => {
              const appName = app.name;
              const handlers = this.addedHandlerInfoPerApp[appName];
              const isIntentHandler = handlers === null || handlers === void 0 ? void 0 : handlers.length;
              if (!isIntentHandler) {
                  return;
              }
              delete this.addedHandlerInfoPerApp[appName];
              handlers.forEach((addedHandlerInfo) => {
                  callback(addedHandlerInfo.handler, addedHandlerInfo.name);
              });
          });
          const unServerMethodAdded = this.interop.serverMethodRemoved(({ method, server }) => {
              if (!method.name.startsWith(GLUE42_FDC3_INTENTS_METHOD_PREFIX)) {
                  return;
              }
              const intentName = method.name.replace(GLUE42_FDC3_INTENTS_METHOD_PREFIX, "");
              const intentsInfo = this.constructIntentHandler({ method, apps: [], server, intentName, title: "" });
              callback(intentsInfo, intentName);
          });
          return () => {
              if (typeof unServerMethodAdded === "function") {
                  unServerMethodAdded();
              }
              if (typeof unAppRemoved === "function") {
                  unAppRemoved();
              }
          };
      }
      toAPI() {
          return {
              all: this.all.bind(this),
              find: this.find.bind(this),
              raise: this.raise.bind(this),
              addIntentListener: this.addIntentListener.bind(this),
              register: this.register.bind(this),
              filterHandlers: this.filterHandlers.bind(this),
              getIntents: this.getIntents.bind(this),
              clearSavedHandlers: this.clearSavedHandlers.bind(this),
              onHandlerAdded: this.onHandlerAdded.bind(this),
              onHandlerRemoved: this.onHandlerRemoved.bind(this)
          };
      }
      filterHandlersBy(intents, filter) {
          const filteredIntentsWithHandlers = intents.filter((intent) => {
              if (filter.intent && filter.intent !== intent.name) {
                  return;
              }
              if (filter.resultType) {
                  const filteredHandlers = intent.handlers.filter((handler) => handler.resultType && handler.resultType === filter.resultType);
                  if (!filteredHandlers.length)
                      return;
                  intent.handlers = filteredHandlers;
              }
              if (filter.contextTypes) {
                  const filteredHandlers = intent.handlers.filter((handler) => { var _a; return (_a = filter.contextTypes) === null || _a === void 0 ? void 0 : _a.every((contextType) => { var _a; return (_a = handler.contextTypes) === null || _a === void 0 ? void 0 : _a.includes(contextType); }); });
                  if (!filteredHandlers.length)
                      return;
                  intent.handlers = filteredHandlers;
              }
              if (filter.applicationNames) {
                  const filteredHandlers = intent.handlers.filter((handler) => { var _a; return (_a = filter.applicationNames) === null || _a === void 0 ? void 0 : _a.includes(handler.applicationName); });
                  if (!filteredHandlers.length)
                      return;
                  intent.handlers = filteredHandlers;
              }
              return intent;
          });
          return filteredIntentsWithHandlers.map((intent) => intent.handlers).flat(1);
      }
      async coreRaiseIntent({ request, resolverInstance, timeout }) {
          var _a, _b;
          const intentDef = await this.get(request.intent);
          if (typeof intentDef === "undefined") {
              throw new Error(`${ERRORS.INTENT_NOT_FOUND} with name ${request.intent}`);
          }
          const { open, reason } = await this.checkIfResolverShouldBeOpenedForRaise(intentDef, request);
          if (!open) {
              this.logger.trace(`Intent Resolver UI won't be used. Reason: ${reason}`);
              return request.waitUserResponseIndefinitely
                  ? PromiseWrap(() => this.raiseIntent(request, timeout), timeout, `${ERRORS.TIMEOUT_HIT} - waited ${timeout}ms for 'raise' to resolve`)
                  : this.raiseIntent(request, timeout);
          }
          const resolverHandler = await this.startResolverApp({ request, method: "raise", resolverInstance });
          (_a = this.logger) === null || _a === void 0 ? void 0 : _a.trace(`Raising intent to target handler: ${JSON.stringify(resolverHandler)} with timeout of ${timeout}`);
          if (request.waitUserResponseIndefinitely) {
              return PromiseWrap(() => this.raiseIntentToTargetHandler(request, resolverHandler, timeout), timeout, `${ERRORS.TIMEOUT_HIT} - waited ${timeout}ms for 'raise' to resolve`);
          }
          const result = await this.raiseIntentToTargetHandler(request, resolverHandler, timeout);
          (_b = this.logger) === null || _b === void 0 ? void 0 : _b.trace(`Result from raise() method for intent ${JSON.stringify(request.intent)}: ${JSON.stringify(result)}`);
          return result;
      }
      async get(intent) {
          return (await this.all()).find((registeredIntent) => registeredIntent.name === intent);
      }
      async raiseIntent(intentRequest, timeout) {
          const intentName = intentRequest.intent;
          const intentDef = await this.get(intentName);
          if (typeof intentDef === "undefined") {
              throw new Error(`${ERRORS.INTENT_NOT_FOUND} with name ${intentRequest.intent}`);
          }
          const firstFoundAppHandler = intentRequest.handlers ? this.findHandlerByFilter(intentRequest.handlers, { type: "app" }) : this.findHandlerByFilter(intentDef.handlers, { type: "app" });
          const firstFoundInstanceHandler = intentRequest.handlers ? this.findHandlerByFilter(intentRequest.handlers, { type: "instance" }) : this.findHandlerByFilter(intentDef.handlers, { type: "instance" });
          let handler;
          if (!intentRequest.target || intentRequest.target === "reuse") {
              handler = firstFoundInstanceHandler || firstFoundAppHandler;
          }
          if (intentRequest.target === "startNew") {
              handler = firstFoundAppHandler;
          }
          if (typeof intentRequest.target === "object" && intentRequest.target.app) {
              handler = this.findHandlerByFilter(intentDef.handlers, { app: intentRequest.target.app });
          }
          if (typeof intentRequest.target === "object" && intentRequest.target.instance) {
              handler = this.findHandlerByFilter(intentDef.handlers, { instance: intentRequest.target.instance, app: intentRequest.target.app });
          }
          if (!handler) {
              throw new Error(`Can not raise intent for request ${JSON.stringify(intentRequest)} - can not find intent handler!`);
          }
          const result = await this.raiseIntentToTargetHandler(intentRequest, handler, timeout);
          return result;
      }
      async raiseIntentToTargetHandler(intentRequest, handler, timeout) {
          var _a, _b;
          (_a = this.logger) === null || _a === void 0 ? void 0 : _a.trace(`Raising intent to target handler:${JSON.stringify(handler)}`);
          if (!handler.instanceId) {
              const instanceIdPromise = this.invokeStartApp(handler.applicationName, intentRequest.context, intentRequest.options).catch((err) => {
                  const reasonMsg = typeof err === "string" ? err : JSON.stringify(err);
                  throw new Error(`${ERRORS.TARGET_INSTANCE_UNAVAILABLE}. Reason: ${reasonMsg}`);
              });
              handler.instanceId = await instanceIdPromise;
          }
          const methodName = `${GLUE42_FDC3_INTENTS_METHOD_PREFIX}${intentRequest.intent}`;
          const invokeOptions = {
              methodResponseTimeoutMs: timeout ? timeout + 1000 : DEFAULT_METHOD_RESPONSE_TIMEOUT_MS,
              waitTimeoutMs: timeout ? timeout + 1000 : DEFAULT_METHOD_RESPONSE_TIMEOUT_MS
          };
          const resultPromise = this.interop.invoke(methodName, intentRequest.context, { instance: handler.instanceId }, invokeOptions)
              .catch((err) => {
              const reasonMsg = typeof err === "string" ? err : JSON.stringify(err);
              throw new Error(`${ERRORS.INTENT_HANDLER_REJECTION}. Reason: ${reasonMsg}`);
          });
          const result = await resultPromise;
          (_b = this.logger) === null || _b === void 0 ? void 0 : _b.trace(`raiseIntent command completed. Returning result: ${JSON.stringify(result)}`);
          return {
              request: intentRequest,
              handler: { ...handler, type: "instance" },
              result: result.returned
          };
      }
      async startResolverApp({ request, method, resolverInstance }) {
          var _a, _b, _c, _d;
          (_a = this.logger) === null || _a === void 0 ? void 0 : _a.trace(`Intents Resolver UI with app name ${this.intentsResolverAppName} will be used for request: ${JSON.stringify(request)}`);
          const responseMethodName = await this.registerIntentResolverMethod();
          (_b = this.logger) === null || _b === void 0 ? void 0 : _b.trace(`Registered interop method ${responseMethodName}`);
          const startContext = this.buildStartContext(method, request, responseMethodName);
          const startOptions = await this.buildStartOptions();
          (_c = this.logger) === null || _c === void 0 ? void 0 : _c.trace(`Starting Intents Resolver UI with context: ${JSON.stringify(startContext)} and options: ${JSON.stringify(startOptions)}`);
          const instance = await this.appManager.application(this.intentsResolverAppName).start(startContext, startOptions);
          resolverInstance.instanceId = instance.id;
          (_d = this.logger) === null || _d === void 0 ? void 0 : _d.trace(`Intents Resolver instance with id ${instance.id} opened`);
          this.subscribeOnInstanceStopped(instance, method);
          const timeout = request.timeout || method === "raise" ? DEFAULT_RAISE_TIMEOUT_MS : DEFAULT_PICK_HANDLER_BY_TIMEOUT_MS;
          this.createResponsePromise({
              intent: method === "raise" ? request.intent : undefined,
              instanceId: instance.id,
              responseMethodName,
              timeout,
              errorMsg: `Timeout of ${timeout}ms hit waiting for the user to choose a handler ${method === "raise"
                ? `for intent ${request.intent}`
                : `for '${method}' method with filter ${JSON.stringify(request)}`}`
          });
          const handler = await this.handleInstanceResponse({ instanceId: instance.id, caller: startContext.initialCaller, method, request });
          return handler;
      }
      async windowsIdToTitle(id, windowsInfos) {
          var _a, _b;
          if (typeof windowsInfos !== "undefined") {
              return (_a = windowsInfos.find((windowsInfo) => windowsInfo.id === id)) === null || _a === void 0 ? void 0 : _a.title;
          }
          const window = (_b = this.windows) === null || _b === void 0 ? void 0 : _b.findById(id);
          const title = await (window === null || window === void 0 ? void 0 : window.getTitle());
          return title;
      }
      async handleInstanceResponse({ instanceId, method, request, caller }) {
          var _a, _b, _c;
          try {
              const response = await this.intentsResolverResponsePromises[instanceId].promise;
              const subMessage = method === "raise" ? `for intent ${response.intent} ` : "";
              (_a = this.logger) === null || _a === void 0 ? void 0 : _a.trace(`Intent handler chosen ${subMessage}: ${JSON.stringify(response.handler)}. Stopping resolver instance with id ${instanceId}`);
              this.stopResolverInstance(instanceId);
              (_b = this.logger) === null || _b === void 0 ? void 0 : _b.trace(`Instance with id ${instanceId} successfully stopped`);
              if ((_c = response.userSettings) === null || _c === void 0 ? void 0 : _c.preserveChoice) {
                  await this.saveUserChoice({
                      intent: response.intent,
                      handler: response.handler,
                      filter: method === "filterHandlers"
                          ? { applicationNames: request.applicationNames, contextTypes: request.contextTypes, resultType: request.resultType }
                          : undefined,
                      caller
                  });
              }
              return response.handler;
          }
          catch (error) {
              this.stopResolverInstance(instanceId);
              throw new Error(error);
          }
      }
      async registerIntentResolverMethod() {
          const methodName = INTENTS_RESOLVER_INTEROP_PREFIX + Utils.generateId();
          await this.interop.register(methodName, (args, callerId) => this.resolverResponseHandler(args, callerId));
          return methodName;
      }
      resolverResponseHandler(args, callerId) {
          const { instance } = callerId;
          const isValid = validateResolverResponse(args);
          if (!isValid) {
              this.logger.trace(`Intent Resolver instance with id ${callerId.instance} sent invalid response. Error: ${isValid.error}`);
              this.intentsResolverResponsePromises[instance].reject(isValid.error);
              this.stopResolverInstance(instance);
              return;
          }
          const validResponse = isValid.ok;
          this.intentsResolverResponsePromises[instance].resolve(validResponse);
          this.cleanUpIntentResolverPromise(instance);
      }
      buildStartContext(method, request, methodName) {
          var _a;
          const myAppName = this.interop.instance.application || this.interop.instance.applicationName;
          const myAppTitle = ((_a = this.appManager.application(myAppName)) === null || _a === void 0 ? void 0 : _a.title) || "";
          const baseStartContext = {
              callerId: this.interop.instance.instance,
              methodName,
              initialCaller: { id: this.interop.instance.instance, applicationName: myAppName, applicationTitle: myAppTitle },
              resolverApi: "1.0"
          };
          return method === "raise"
              ? { ...baseStartContext, intent: request }
              : { ...baseStartContext, handlerFilter: request };
      }
      async buildStartOptions() {
          const win = this.windows.my();
          if (!win) {
              return;
          }
          const bounds = await win.getBounds();
          return {
              top: await this.getResolverStartupTopBound(bounds),
              left: (bounds.width - INTENTS_RESOLVER_WIDTH) / 2 + bounds.left,
              width: INTENTS_RESOLVER_WIDTH,
              height: INTENTS_RESOLVER_HEIGHT
          };
      }
      async getResolverStartupTopBound(bounds) {
          const myDisplay = await this.windows.my().getDisplay();
          const minWorkareaHeight = myDisplay.workArea.height;
          const top = (bounds.height - INTENTS_RESOLVER_HEIGHT) / 2 + bounds.top;
          if (top < 0) {
              return 0;
          }
          if (top + INTENTS_RESOLVER_HEIGHT > minWorkareaHeight) {
              return minWorkareaHeight / 2;
          }
          return top;
      }
      createResponsePromise({ instanceId, intent, responseMethodName, timeout, errorMsg }) {
          let resolve = () => { };
          let reject = () => { };
          const promise = PromisePlus((res, rej) => {
              resolve = res;
              reject = rej;
          }, timeout, errorMsg);
          this.intentsResolverResponsePromises[instanceId] = { intent, resolve, reject, promise, methodName: responseMethodName };
      }
      async invokeStartApp(application, context, options) {
          const result = await this.interop.invoke("T42.ACS.StartApplication", { Name: application, options: { ...options, startedByIntentAPI: true } }, "best", {
              waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
              methodResponseTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS
          });
          return result.returned.Id;
      }
      subscribeOnInstanceStopped(instance, method) {
          const { application } = instance;
          const unsub = application.onInstanceStopped((inst) => {
              if (inst.id !== instance.id) {
                  return;
              }
              const intentPromise = this.intentsResolverResponsePromises[inst.id];
              if (!intentPromise) {
                  return unsub();
              }
              const errorMsg = `Cannot resolve ${method === "raise" ? `raised intent ${intentPromise.intent}` : `'${method}' method`} - User closed ${instance.application.name} app without choosing a handler`;
              intentPromise.reject(errorMsg);
              this.cleanUpIntentResolverPromise(inst.id);
              unsub();
          });
      }
      async cleanUpIntentResolverPromise(instanceId) {
          const intentPromise = this.intentsResolverResponsePromises[instanceId];
          if (!intentPromise) {
              return;
          }
          const unregisterPromise = this.interop.unregister(intentPromise.methodName);
          unregisterPromise.catch((error) => this.logger.warn(error));
          delete this.intentsResolverResponsePromises[instanceId];
      }
      handleRaiseOnError(instanceId) {
          if (!instanceId) {
              return;
          }
          this.stopResolverInstance(instanceId);
      }
      stopResolverInstance(instanceId) {
          const gdWin = this.windows.findById(instanceId);
          gdWin === null || gdWin === void 0 ? void 0 : gdWin.close().catch((err) => this.logger.error(err));
      }
      checkIfIntentsResolverIsEnabled(options, appManager) {
          var _a, _b, _c, _d, _e;
          if (!appManager) {
              this.useIntentsResolverUI = false;
              return;
          }
          this.useIntentsResolverUI = typeof ((_a = options.intents) === null || _a === void 0 ? void 0 : _a.enableIntentsResolverUI) === "boolean"
              ? options.intents.enableIntentsResolverUI
              : true;
          this.intentsResolverAppName = (_c = (_b = options.intents) === null || _b === void 0 ? void 0 : _b.intentsResolverAppName) !== null && _c !== void 0 ? _c : INTENTS_RESOLVER_APP_NAME;
          this.intentsResolverResponseTimeout = (_e = (_d = options.intents) === null || _d === void 0 ? void 0 : _d.methodResponseTimeoutMs) !== null && _e !== void 0 ? _e : DEFAULT_RESOLVER_RESPONSE_TIMEOUT;
      }
      async checkIfResolverShouldBeOpenedForRaise(intent, request) {
          const checkOpen = this.checkIfIntentsResolverShouldBeOpened();
          if (!checkOpen.open) {
              return checkOpen;
          }
          const hasMoreThanOneHandler = await this.checkIfIntentHasMoreThanOneHandler(intent, request);
          if (!hasMoreThanOneHandler) {
              return { open: false, reason: `Raised intent ${intent.name} has only one handler` };
          }
          return { open: true };
      }
      checkIfResolverShouldBeOpenedForFilterHandlers(handlers, filter) {
          if (handlers.length === 1) {
              return { open: false, reason: `There's only one valid intent handler for filter ${JSON.stringify(filter)}` };
          }
          if (typeof (filter === null || filter === void 0 ? void 0 : filter.openResolver) === "boolean" && !filter.openResolver) {
              return { open: false, reason: "Intents resolver is disabled by IntentHandler filter" };
          }
          return this.checkIfIntentsResolverShouldBeOpened();
      }
      checkIfIntentsResolverShouldBeOpened() {
          if (!this.useIntentsResolverUI) {
              return { open: false, reason: `Intent Resolver is disabled. Resolving to first found handler` };
          }
          const intentsResolverApp = this.appManager.application(this.intentsResolverAppName);
          if (!intentsResolverApp) {
              return { open: false, reason: `Intent Resolver Application with name ${this.intentsResolverAppName} not found.` };
          }
          return { open: true };
      }
      async checkIfIntentHasMoreThanOneHandler(intent, request) {
          const handlers = await this.removeSingletons(request.handlers || intent.handlers);
          if (!request.target) {
              return handlers.length > 1;
          }
          if (request.target === "reuse") {
              return handlers.filter(handler => handler.type === "instance" && handler.instanceId).length > 1 || intent.handlers.filter(handler => handler.type === "app").length > 1;
          }
          if (request.target === "startNew") {
              return handlers.filter(handler => handler.type === "app").length > 1;
          }
          if (request.target.instance) {
              return false;
          }
          if (request.target.app) {
              const searchedAppName = request.target.app;
              const instanceHandlersByAppName = handlers.filter((handler) => handler.applicationName === searchedAppName && handler.instanceId);
              return instanceHandlersByAppName.length > 1;
          }
          return false;
      }
      async removeSingletons(handlers) {
          const handlersWithSingletonProp = await Promise.all(handlers.map(async (handler) => {
              if (handler.type === "instance") {
                  return handler;
              }
              const appConfig = await this.appManager.application(handler.applicationName).getConfiguration();
              const isSingleton = appConfig.allowMultiple === false;
              return { ...handler, isSingleton };
          }));
          const filteredSingletonsWithOpenedInstances = handlersWithSingletonProp.filter((handler, _, currentHandlers) => {
              if (handler.instanceId || !handler.isSingleton) {
                  return handler;
              }
              const openedInstance = currentHandlers.find((h) => h.instanceId && h.applicationName === handler.applicationName);
              if (openedInstance) {
                  return;
              }
              return handler;
          });
          return filteredSingletonsWithOpenedInstances;
      }
      buildInteropMethodName(intentName) {
          return `${GLUE42_FDC3_INTENTS_METHOD_PREFIX}${intentName}`;
      }
      clearUnregistrationPromise(promiseToRemove) {
          this.unregisterIntentPromises = this.unregisterIntentPromises.filter((promise) => promise !== promiseToRemove);
      }
      unsubscribeIntent(intentName) {
          this.myIntents.delete(intentName);
          const methodName = this.buildInteropMethodName(intentName);
          const unregisterPromise = this.interop.unregister(methodName);
          this.unregisterIntentPromises.push(unregisterPromise);
          unregisterPromise
              .then(() => {
              this.clearUnregistrationPromise(unregisterPromise);
          })
              .catch((err) => {
              this.logger.error(`Unregistration of a method with name ${methodName} failed with reason: `, err);
              this.clearUnregistrationPromise(unregisterPromise);
          });
      }
      findHandlerByFilter(handlers, filter) {
          if (filter.type) {
              return handlers.find((handler) => handler.type === filter.type);
          }
          if (filter.instance) {
              return handlers.find((handler) => filter.app
                  ? handler.applicationName === filter.app && handler.instanceId === filter.instance
                  : handler.instanceId === filter.instance);
          }
          if (filter.app) {
              return handlers.find((handler) => handler.applicationName === filter.app);
          }
      }
      extractIntentsWithInfoByHandler(intents, handler) {
          const intentsWithInfo = intents.reduce((validIntentsWithInfo, intent) => {
              intent.handlers.forEach((currentHandler) => {
                  const isValid = Object.keys(handler).every((key) => {
                      var _a;
                      return key === "contextTypes"
                          ? (_a = handler.contextTypes) === null || _a === void 0 ? void 0 : _a.every((contextType) => { var _a; return (_a = currentHandler.contextTypes) === null || _a === void 0 ? void 0 : _a.includes(contextType); })
                          : currentHandler[key] === handler[key];
                  });
                  if (!isValid) {
                      return;
                  }
                  const intentWithInfo = {
                      intent: intent.name,
                      contextTypes: currentHandler.contextTypes,
                      description: currentHandler.applicationDescription,
                      displayName: currentHandler.displayName,
                      icon: currentHandler.applicationIcon,
                      resultType: currentHandler.resultType
                  };
                  validIntentsWithInfo.push(intentWithInfo);
              });
              return validIntentsWithInfo;
          }, []);
          return intentsWithInfo;
      }
      async removeRememberedHandler(intentName) {
          var _a;
          this.logger.trace(`Removing saved handler from prefs storage for intent ${intentName}`);
          let prefs;
          try {
              prefs = await this.prefsController.get();
          }
          catch (error) {
              this.logger.warn(`prefs.get() threw the following error: ${typeof error === "string" ? error : JSON.stringify(error)}`);
              return;
          }
          const intentPrefs = (_a = prefs.data) === null || _a === void 0 ? void 0 : _a.intents;
          if (!intentPrefs) {
              this.logger.trace("No app prefs found for current app");
              return;
          }
          delete intentPrefs[intentName];
          const updatedPrefs = {
              ...prefs.data,
              intents: intentPrefs
          };
          try {
              await this.prefsController.update(updatedPrefs);
          }
          catch (error) {
              this.logger.warn(`prefs.update() threw the following error: ${typeof error === "string" ? error : JSON.stringify(error)}`);
              return;
          }
          this.logger.trace(`Handler saved choice for intent ${intentName} removed successfully`);
      }
      async checkForRememberedHandler(intentRequest) {
          var _a, _b;
          let prefs;
          try {
              prefs = await this.prefsController.get();
          }
          catch (error) {
              this.logger.warn(`prefs.get() threw the following error: ${typeof error === "string" ? error : JSON.stringify(error)}`);
              return;
          }
          const prefsForIntent = (_b = (_a = prefs.data) === null || _a === void 0 ? void 0 : _a.intents) === null || _b === void 0 ? void 0 : _b[intentRequest.intent];
          return prefsForIntent === null || prefsForIntent === void 0 ? void 0 : prefsForIntent.handler;
      }
      async checkHandleRaiseWithRememberedHandler(intentRequest, resolverInstance, timeout) {
          if (intentRequest.target) {
              return;
          }
          const rememberedHandler = await this.checkForRememberedHandler(intentRequest);
          if (!rememberedHandler) {
              return;
          }
          const request = {
              ...intentRequest,
              target: {
                  app: rememberedHandler.applicationName,
                  instance: rememberedHandler.instanceId
              }
          };
          try {
              const response = await this.coreRaiseIntent({ request, resolverInstance, timeout });
              return response;
          }
          catch (error) {
              this.logger.trace("Could not raise intent to remembered handler. Removing it from Prefs store");
              await this.removeRememberedHandler(intentRequest.intent);
          }
      }
      async saveUserChoice({ intent, handler, filter, caller }) {
          var _a, _b;
          const prevPrefs = await this.prefsController.get(caller.applicationName);
          const prevIntentsPrefs = ((_a = prevPrefs === null || prevPrefs === void 0 ? void 0 : prevPrefs.data) === null || _a === void 0 ? void 0 : _a.intents) || {};
          const prefsToUpdate = {
              ...prevPrefs.data,
              intents: {
                  ...prevIntentsPrefs,
                  [intent]: { handler, filter }
              }
          };
          await this.prefsController.update(prefsToUpdate, { app: caller.applicationName });
          (_b = this.logger) === null || _b === void 0 ? void 0 : _b.info(`Saved user's choice of handler for '${caller.applicationName}' app`);
      }
      constructIntentHandler({ apps, intentName, method, server, title }) {
          const info = method.flags.intent;
          const app = apps.find((appWithIntents) => appWithIntents.name === server.application);
          let appIntent;
          if (app === null || app === void 0 ? void 0 : app.intents) {
              appIntent = app.intents.find((appDefIntent) => appDefIntent.name === intentName);
          }
          const handler = {
              instanceId: server.instance,
              applicationName: server.application,
              applicationIcon: info.icon || (app === null || app === void 0 ? void 0 : app.icon),
              applicationTitle: (app === null || app === void 0 ? void 0 : app.title) || "",
              applicationDescription: info.description || (app === null || app === void 0 ? void 0 : app.caption),
              displayName: info.displayName || (appIntent === null || appIntent === void 0 ? void 0 : appIntent.displayName),
              contextTypes: info.contextTypes || (appIntent === null || appIntent === void 0 ? void 0 : appIntent.contexts),
              instanceTitle: title,
              type: "instance",
              resultType: (appIntent === null || appIntent === void 0 ? void 0 : appIntent.resultType) || info.resultType
          };
          return handler;
      }
      constructIntentHandlerFromApp(app, intent) {
          return {
              applicationName: app.name,
              applicationTitle: app.title || "",
              applicationDescription: app.caption,
              displayName: intent.displayName,
              contextTypes: intent.contexts,
              applicationIcon: app.icon,
              type: "app",
              resultType: intent.resultType
          };
      }
  }

  class FactoryCallInfo {
      constructor() {
          this.initialized = false;
          this.details = [];
          this.reject = () => { };
          this.resolve = () => { };
      }
      init(config) {
          this.initialized = true;
          this.addCall(config);
          this.promise = new Promise((resolve, reject) => {
              this.resolve = resolve;
              this.reject = reject;
          });
      }
      addCall(config) {
          this.details.push({ date: new Date(), config });
      }
      done(g) {
          this.resolve(g);
      }
      error(e) {
          this.reject(e);
      }
  }

  class Prefs {
      constructor(appName, interop) {
          this.appName = appName;
          this.interop = interop;
          this.registry = CallbackRegistryFactory();
          this.interopMethodRegistered = false;
      }
      async get(app) {
          const data = (await this.interop.invoke(Prefs.T42GetPrefsMethodName, { app: app !== null && app !== void 0 ? app : this.appName }, "best", {
              waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
              methodResponseTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS
          }));
          return data.returned;
      }
      async set(data, options) {
          var _a;
          this.verifyDataObject(data);
          await this.interop.invoke(Prefs.T42SetPrefsMethodName, { app: (_a = options === null || options === void 0 ? void 0 : options.app) !== null && _a !== void 0 ? _a : this.appName, data, merge: false }, "best", {
              waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
              methodResponseTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS
          });
      }
      async setFor(app, data) {
          this.verifyApp(app);
          this.verifyDataObject(data);
          return this.set(data, { app });
      }
      async update(data, options) {
          var _a;
          this.verifyDataObject(data);
          await this.interop.invoke(Prefs.T42SetPrefsMethodName, { app: (_a = options === null || options === void 0 ? void 0 : options.app) !== null && _a !== void 0 ? _a : this.appName, data, merge: true }, "best", {
              waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
              methodResponseTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS
          });
      }
      async updateFor(app, data) {
          this.verifyApp(app);
          this.verifyDataObject(data);
          return this.update(data, { app });
      }
      async clear(app) {
          await this.interop.invoke(Prefs.T42SetPrefsMethodName, { app: app !== null && app !== void 0 ? app : this.appName, clear: true }, "best", {
              waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
              methodResponseTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS
          });
      }
      async clearFor(app) {
          this.verifyApp(app);
          await this.interop.invoke(Prefs.T42SetPrefsMethodName, { app, clear: true }, "best", {
              waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
              methodResponseTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS
          });
      }
      async getAll() {
          const data = (await this.interop.invoke(Prefs.T42GetPrefsMethodName, undefined, "best", {
              waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
              methodResponseTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS
          }));
          return data.returned;
      }
      async clearAll() {
          await this.interop.invoke(Prefs.T42SetPrefsMethodName, { clear: true }, "best", {
              waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
              methodResponseTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS
          });
      }
      subscribe(callback) {
          this.verifyCallback(callback);
          return this.subscribeFor(this.appName, callback);
      }
      subscribeFor(app, callback) {
          this.verifyApp(app);
          this.verifyCallback(callback);
          const unsubscribeFn = this.registry.add(app, callback);
          this.registerInteropIfNeeded()
              .then(() => {
              this.interop.invoke(Prefs.T42GetPrefsMethodName, { app, subscribe: true }, "best", {
                  waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
                  methodResponseTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS
              });
          });
          return () => {
              unsubscribeFn();
          };
      }
      async registerInteropIfNeeded() {
          if (this.interopMethodRegistered) {
              return;
          }
          this.interopMethodRegistered = true;
          await this.interop.register(Prefs.T42UpdatePrefsMethodName, (args) => {
              this.registry.execute(args.app, args);
          });
      }
      verifyApp(app) {
          if (!app) {
              throw new Error(`app should be defined`);
          }
          if (!isString(app)) {
              throw new Error(`app should be a string`);
          }
      }
      verifyDataObject(data) {
          if (!data) {
              throw new Error(`data should be defined`);
          }
          if (!isObject(data)) {
              throw new Error(`data should be an object`);
          }
      }
      verifyCallback(callback) {
          if (!isFunction(callback)) {
              throw new Error(`callback should be defined`);
          }
      }
  }
  Prefs.T42UpdatePrefsMethodName = "T42.Prefs.Update";
  Prefs.T42GetPrefsMethodName = "T42.Prefs.Get";
  Prefs.T42SetPrefsMethodName = "T42.Prefs.Set";

  class Cookies {
      constructor(methodName, interop) {
          this.methodName = methodName;
          this.interop = interop;
      }
      async get(filter) {
          const result = await this.invoke("get-cookies", { filter });
          return result.returned.cookies;
      }
      async set(cookie) {
          this.verifyCookieObject(cookie);
          await this.invoke("set-cookie", cookie);
      }
      async remove(url, name) {
          if (!isString(url)) {
              throw new Error(`url should be a string`);
          }
          if (!isString(name)) {
              throw new Error(`name should be a string`);
          }
          await this.invoke("remove-cookie", { url, name });
      }
      invoke(command, data) {
          return this.interop.invoke(this.methodName, { command, args: data }, "best", {
              waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
              methodResponseTimeoutMs: INTEROP_METHOD_RESPONSE_TIMEOUT_MS,
          });
      }
      verifyCookieObject(cookie) {
          if (!cookie) {
              throw new Error(`cookie should be defined`);
          }
          if (!isObject(cookie)) {
              throw new Error(`cookie should be an object`);
          }
          if (Utils.isNullOrUndefined(cookie.url) || !isString(cookie.url)) {
              throw new Error(`cookie.url should be a string`);
          }
          if (Utils.isNullOrUndefined(cookie.name) || !isString(cookie.name)) {
              throw new Error(`cookie.name should be a string`);
          }
          if (!Utils.isNullOrUndefined(cookie.value) && !isString(cookie.value)) {
              throw new Error(`cookie.value should be a string`);
          }
          if (!Utils.isNullOrUndefined(cookie.domain) && !isString(cookie.domain)) {
              throw new Error(`cookie.domain should be a string`);
          }
          if (!Utils.isNullOrUndefined(cookie.path) && !isString(cookie.path)) {
              throw new Error(`cookie.path should be a string`);
          }
          if (!Utils.isNullOrUndefined(cookie.secure) && typeof cookie.secure !== "boolean") {
              throw new Error(`cookie.secure should be a boolean`);
          }
          if (!Utils.isNullOrUndefined(cookie.httpOnly) && typeof cookie.httpOnly !== "boolean") {
              throw new Error(`cookie.httpOnly should be a boolean`);
          }
          if (!Utils.isNullOrUndefined(cookie.expirationDate) && typeof cookie.expirationDate !== "number") {
              throw new Error(`cookie.expirationDate should be a number`);
          }
      }
  }

  function factory$1(agm, methodName) {
      const cookies = new Cookies(methodName, agm);
      return {
          get: cookies.get.bind(cookies),
          remove: cookies.remove.bind(cookies),
          set: cookies.set.bind(cookies),
          ready: () => Promise.resolve()
      };
  }

  class EventsDispatcher {
      constructor(config) {
          this.config = config;
          this.glue42EventName = "Glue42";
          this.events = {
              notifyStarted: { name: "notifyStarted", handle: this.handleNotifyStarted.bind(this) },
              requestGlue: { name: "requestGlue", handle: this.handleRequestGlue.bind(this) }
          };
      }
      start(glue) {
          if (Utils.isNode()) {
              return;
          }
          this.glue = glue;
          this.wireCustomEventListener();
          this.announceStarted();
      }
      wireCustomEventListener() {
          window.addEventListener(this.glue42EventName, (event) => {
              const data = event.detail;
              if (!data || !data.glue42) {
                  return;
              }
              const glue42Event = data.glue42.event;
              const foundHandler = this.events[glue42Event];
              if (!foundHandler) {
                  return;
              }
              foundHandler.handle(data.glue42.message);
          });
      }
      announceStarted() {
          this.send("start");
      }
      handleRequestGlue() {
          if (!this.config.exposeAPI) {
              this.send("requestGlueResponse", { error: "Will not give access to the underlying Glue API, because it was explicitly denied upon initialization." });
              return;
          }
          this.send("requestGlueResponse", { glue: this.glue });
      }
      handleNotifyStarted() {
          this.announceStarted();
      }
      send(eventName, message) {
          const payload = { glue42: { event: eventName, message } };
          const event = new CustomEvent(this.glue42EventName, { detail: payload });
          window.dispatchEvent(event);
      }
  }

  class PromiseWrapper {
      static delay(time) {
          return new Promise((resolve) => setTimeout(resolve, time));
      }
      static async delayForever() {
          const biggestPossibleDelay = 2147483647;
          while (true) {
              await this.delay(biggestPossibleDelay);
          }
      }
      get ended() {
          return this.rejected || this.resolved;
      }
      constructor() {
          this.promise = new Promise((resolve, reject) => {
              this.resolve = (t) => {
                  this.resolved = true;
                  resolve(t);
              };
              this.reject = (err) => {
                  this.rejected = true;
                  reject(err);
              };
          });
      }
  }

  class Interception {
      constructor() {
          this.InterceptorMethodName = "T42.GD.Interception.Execute";
          this.InterceptorHandlerMethodName = "T42.GD.Interception.Handler";
          this.interceptions = [];
      }
      init(interop) {
          this.interop = interop;
      }
      async register(request) {
          if (!request || typeof request !== "object" || Array.isArray(request)) {
              throw new Error(`Please provide a valid object.`);
          }
          const handler = request.handler;
          if (typeof handler !== "function") {
              throw new Error("Please provide a valid handler function.");
          }
          const interceptions = request.interceptions;
          this.validateInterceptions(interceptions);
          this.interceptions.push(request);
          try {
              await this.interop.invoke(this.InterceptorMethodName, {
                  command: "register",
                  interceptions
              }, "best", {
                  waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
                  methodResponseTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS
              });
              await this.registerMethodIfNotRegistered();
          }
          catch (error) {
              this.interceptions = this.interceptions.filter((i) => i !== request);
              const message = error.message || "Unknown error";
              const newError = new Error(`Failed to register interception: ${message}`);
              throw newError;
          }
      }
      async unregister(request) {
          if (!request || typeof request !== "object" || Array.isArray(request)) {
              throw new Error(`Please provide a valid object.`);
          }
          const interceptions = request.interceptions;
          this.validateInterceptions(interceptions);
          try {
              await this.interop.invoke(this.InterceptorMethodName, {
                  command: "unregister",
                  interceptions
              }, "best", {
                  waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
                  methodResponseTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS
              });
              this.interceptions = this.interceptions.filter((config) => {
                  return !interceptions.some((interception) => {
                      return config.interceptions.some((i) => {
                          return i.domain === interception.domain && i.operation === interception.operation;
                      });
                  });
              });
          }
          catch (error) {
              const message = error.message || "Unknown error";
              const newError = new Error(`Failed to unregister interception: ${message}`);
              throw newError;
          }
      }
      async handleInterception(domain, operation, operationArgs, phase) {
          if (this.interop.methods(this.InterceptorMethodName).length === 0) {
              return {};
          }
          const result = await this.interop.invoke(this.InterceptorMethodName, {
              command: "raiseInterception",
              interceptions: [{
                      operationArgs,
                      domain,
                      operation,
                      phase
                  }]
          }, 'best', {
              waitTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS,
              methodResponseTimeoutMs: INTEROP_METHOD_WAIT_TIMEOUT_MS
          });
          return result.returned;
      }
      static createProxyObject(apiToIntercept, domain, interception) {
          const methods = Interception.OperationsPerDomain[domain] || [];
          const handler = {
              get(target, propertyKey, receiver) {
                  const property = Reflect.get(target, propertyKey, receiver);
                  try {
                      if (typeof property !== "function") {
                          return property;
                      }
                      const shouldIntercept = methods.includes(propertyKey);
                      const isAwaitable = Utils.isPromise(property) || Utils.isAsyncFunction(property);
                      if (!shouldIntercept || !isAwaitable) {
                          return property;
                      }
                      return Interception.interceptMethod(property, propertyKey, target, domain, interception);
                  }
                  catch (error) {
                      return property;
                  }
              }
          };
          const proxyAPI = new Proxy(apiToIntercept, handler);
          return proxyAPI;
      }
      static interceptMethod(originalMethod, propertyKey, target, domain, interception) {
          return async function (...args) {
              const beforeInterceptionResult = await interception.handleInterception(domain, propertyKey, args, "before");
              if (!Utils.isNullOrUndefined(beforeInterceptionResult.operationResult)) {
                  return beforeInterceptionResult.operationResult;
              }
              if (!Utils.isNullOrUndefined(beforeInterceptionResult.operationArgs)) {
                  args = beforeInterceptionResult.operationArgs;
              }
              const methodResult = await originalMethod.apply(target, args);
              const afterInterceptionResult = await interception.handleInterception(domain, propertyKey, [methodResult], "after");
              if (!Utils.isNullOrUndefined(afterInterceptionResult.operationResult)) {
                  return afterInterceptionResult.operationResult;
              }
              return methodResult;
          };
      }
      toAPI() {
          return {
              register: this.register.bind(this),
              unregister: this.unregister.bind(this),
          };
      }
      async registerMethodIfNotRegistered() {
          var _a;
          if ((_a = this.whenRegisteredPromise) === null || _a === void 0 ? void 0 : _a.ended) {
              return;
          }
          this.whenRegisteredPromise = new PromiseWrapper();
          this.registerMethod();
      }
      async registerMethod() {
          await this.interop.register(this.InterceptorHandlerMethodName, async (data) => {
              const command = data.command;
              if (command === "raiseInterception") {
                  const raisedInterception = data.interception;
                  const interceptor = this.interceptions.find((config) => {
                      return config.interceptions.some((interception) => {
                          return interception.domain === raisedInterception.domain && interception.operation === raisedInterception.operation;
                      });
                  });
                  const result = await interceptor.handler(raisedInterception);
                  return result;
              }
          });
          this.whenRegisteredPromise.resolve();
      }
      validateInterceptions(interceptions) {
          if (!Array.isArray(interceptions)) {
              throw new Error("Please provide a valid array of interceptions.");
          }
          if (interceptions.length === 0) {
              throw new Error("Please provide at least one interception.");
          }
          for (const interception of interceptions) {
              if (typeof interception === "undefined" || interception === null || typeof interception !== "object" || Array.isArray(interception)) {
                  throw new Error("Please provide a valid interception object.");
              }
              if (typeof interception.domain !== "string" || !interception.domain) {
                  throw new Error("Please provide a valid domain string.");
              }
              if (typeof interception.operation !== "string" || !interception.operation) {
                  throw new Error("Please provide a valid operation string.");
              }
              this.validateTypeString(interception);
          }
      }
      validateTypeString(interception) {
          if (!isUndefinedOrNull(interception.phase)) {
              const isValidType = ["all", "before", "after"].includes(interception.phase);
              if (typeof interception.phase !== "string" || !isValidType) {
                  throw new Error("Please provide a valid phase string.");
              }
          }
      }
  }
  Interception.OperationsPerDomain = {
      "intents": ["raise"]
  };

  const callInfo = new FactoryCallInfo();
  const factory = async (options) => {
      let firstRun = false;
      if (!callInfo.initialized) {
          firstRun = true;
          callInfo.init(options);
      }
      const glue42gd = typeof window !== "undefined" && window.glue42gd;
      if (glue42gd) {
          if (!firstRun) {
              callInfo.addCall(options);
              return callInfo.promise;
          }
      }
      const g = await factoryCore(options, glue42gd);
      callInfo.resolve(g);
      return g;
  };
  const factoryCore = async (options, glue42gd) => {
      const T42GDExecuteMethod = "T42.GD.Execute";
      const gdMajorVersion = Utils.getGDMajorVersion();
      options = options || {};
      const glueConfig = prepareConfig(options);
      options.gateway = options.gateway || {};
      let _appManager;
      let _activity;
      let _windows;
      let _displays;
      let _channels;
      let _prefs;
      const _interceptors = new Interception();
      const _browserEventsDispatcher = new EventsDispatcher(glueConfig);
      function createWindows(core) {
          if (glueConfig.windows) {
              const windowsLogger = getLibLogger("windows", core.logger, glueConfig.windows);
              _windows = WindowsFactory(core.agm, windowsLogger, () => {
                  return _appManager;
              }, () => {
                  return _displays;
              }, () => {
                  return _channels;
              }, gdMajorVersion);
              debugLog(_windows);
              return _windows;
          }
      }
      function createActivities(core) {
          var _a;
          if (glueConfig.activities) {
              if (ActivityModule.checkIsUsingGW3Implementation && ActivityModule.checkIsUsingGW3Implementation(core.connection)) {
                  const activityLogger = getLibLogger("activity", core.logger, glueConfig.activities);
                  _activity = new ActivityModule({
                      connection: core.connection,
                      contexts: core.contexts,
                      agm: core.agm,
                      logger: activityLogger,
                      logLevel: "info",
                      disableAutoAnnounce: false,
                      disposeRequestHandling: "exit",
                      announcementInfo: null,
                      windows: _windows,
                      appManagerGetter: () => {
                          return _appManager;
                      },
                      mode: glueConfig.activities.mode,
                      typesToTrack: glueConfig.activities.typesToTrack,
                      activityId: (_a = glue42gd === null || glue42gd === void 0 ? void 0 : glue42gd.activityInfo) === null || _a === void 0 ? void 0 : _a.activityId,
                      gdMajorVersion
                  }).api;
                  debugLog(_activity);
                  return _activity;
              }
          }
      }
      function createAppManager(core) {
          if (!glueConfig.appManager) {
              return;
          }
          const logger = getLibLogger("appManager", core.logger, glueConfig.appManager);
          _appManager = AppManagerFactory({
              agm: core.agm,
              windows: _windows,
              logger,
              activities: _activity,
              mode: glueConfig.appManager.mode,
              gdMajorVersion
          });
          debugLog(_appManager);
          return _appManager;
      }
      function createLayouts(core) {
          var _a;
          if (!glueConfig.layouts) {
              return;
          }
          const logger = getLibLogger("layouts", core.logger, glueConfig.layouts);
          const layoutsConfig = glueConfig.layouts;
          const lay = LayoutsFactory({
              agm: core.agm,
              appManager: _appManager,
              activityGetter: () => _activity,
              logger,
              mode: layoutsConfig.mode,
              autoSaveWindowContext: (_a = layoutsConfig.autoSaveWindowContext) !== null && _a !== void 0 ? _a : false,
              gdMajorVersion
          });
          debugLog(lay);
          return lay;
      }
      function createChannels(core) {
          if (!glueConfig.channels) {
              return;
          }
          const logger = getLibLogger("channels", core.logger, glueConfig.channels);
          if (!core.contexts) {
              logger.error("Channels library requires Contexts library to be initialized.");
              return;
          }
          _channels = factory$4({ operationMode: glueConfig.channels.operationMode }, core.contexts, core.agm, () => _windows, () => _appManager, logger);
          debugLog(_channels);
          return _channels;
      }
      function createHotkeys(core) {
          const hotkeysAPI = factory$3(core.agm);
          debugLog(hotkeysAPI);
          return hotkeysAPI;
      }
      function createIntents(core) {
          const domain = "intents";
          const intents = new Intents(core.agm, _windows, core.logger.subLogger(domain), options, _prefs, _appManager);
          const intentsAPI = intents.toAPI();
          const proxyIntentsAPI = Interception.createProxyObject(intentsAPI, domain, _interceptors);
          debugLog(proxyIntentsAPI);
          return proxyIntentsAPI;
      }
      function createNotifications(core) {
          const notificationsAPI = new Notifications(core.interop, core.logger).toAPI();
          debugLog(notificationsAPI);
          return notificationsAPI;
      }
      function createDisplaysApi(core) {
          if (glueConfig.displays) {
              const displaysLogger = getLibLogger("displays", core.logger, glueConfig.displays);
              _displays = new DisplayManager(core.agm, displaysLogger);
              debugLog(_displays);
              return _displays;
          }
      }
      function createThemes(core) {
          if (!core.contexts) {
              return;
          }
          const themesAPI = factory$2(core.contexts, core.interop);
          debugLog(themesAPI);
          return themesAPI;
      }
      function createPrefs(core) {
          var _a, _b;
          const appName = (_b = (_a = options.application) !== null && _a !== void 0 ? _a : glue42gd === null || glue42gd === void 0 ? void 0 : glue42gd.applicationName) !== null && _b !== void 0 ? _b : core.interop.instance.application;
          _prefs = new Prefs(appName, core.interop);
          debugLog(_prefs);
          return _prefs;
      }
      function createCookies(core) {
          const api = factory$1(core.interop, T42GDExecuteMethod);
          debugLog(api);
          return api;
      }
      function createInterception(core) {
          _interceptors.init(core.interop);
          debugLog(_interceptors);
          return _interceptors.toAPI();
      }
      function getLibLogger(loggerName, logger, config) {
          const newLogger = logger.subLogger(loggerName);
          if (config && config.logger) {
              const loggerConfig = config.logger;
              if (loggerConfig.console) {
                  newLogger.consoleLevel(loggerConfig.console);
              }
              if (loggerConfig.publish) {
                  newLogger.publishLevel(loggerConfig.publish);
              }
          }
          return newLogger;
      }
      const ext = {
          libs: [
              { name: "windows", create: createWindows },
              { name: "activities", create: createActivities },
              { name: "appManager", create: createAppManager },
              { name: "layouts", create: createLayouts },
              { name: "channels", create: createChannels },
              { name: "hotkeys", create: createHotkeys },
              { name: "displays", create: createDisplaysApi },
              { name: "prefs", create: createPrefs },
              { name: "intents", create: createIntents },
              { name: "notifications", create: createNotifications },
              { name: "themes", create: createThemes },
              { name: "cookies", create: createCookies },
              { name: "interception", create: createInterception }
          ],
          version,
          enrichGlue: (glue) => {
              glue.config.activities = glueConfig.activities;
              glue.config.windows = glueConfig.windows;
              glue.config.appManager = glueConfig.appManager;
              glue.config.layouts = glueConfig.layouts;
              glue.config.channels = glueConfig.channels;
              glue.config.displays = glueConfig.displays;
          },
      };
      const currentLog = [];
      if (typeof window !== "undefined") {
          if (!window.glueFactoryLog) {
              window.glueFactoryLog = [];
          }
          window.glueFactoryLog.push(currentLog);
      }
      function debugLog(entry) {
          currentLog.push(entry);
      }
      const glueApi = (await IOConnectCoreFactory(options, ext));
      if (Array.isArray(options === null || options === void 0 ? void 0 : options.libraries) && options.libraries.length) {
          await Promise.all(options.libraries.map((lib) => lib(glueApi, options)));
      }
      _browserEventsDispatcher.start(glueApi);
      return glueApi;
  };
  factory.coreVersion = IOConnectCoreFactory.version;
  factory.version = version;
  factory.calls = callInfo;

  var _a, _b;
  let whatToExpose = factory;
  let shouldSetToWindow = true;
  if (typeof window !== "undefined") {
      const windowAsAny = window;
      const iodesktop = (_a = windowAsAny.iodesktop) !== null && _a !== void 0 ? _a : windowAsAny.glue42gd;
      if (iodesktop && iodesktop.autoInjected) {
          whatToExpose = (_b = windowAsAny.IODesktop) !== null && _b !== void 0 ? _b : windowAsAny.Glue;
          shouldSetToWindow = false;
      }
      if (shouldSetToWindow) {
          windowAsAny.Glue = whatToExpose;
          windowAsAny.IODesktop = whatToExpose;
      }
      delete windowAsAny.IOBrowser;
      delete windowAsAny.GlueCore;
  }
  whatToExpose.default = whatToExpose;
  var whatToExpose$1 = whatToExpose;

  return whatToExpose$1;

}));
//# sourceMappingURL=desktop.umd.js.map
