"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LogserverTransport = void 0;
const winston_transport_1 = __importDefault(require("winston-transport"));
const triple_beam_1 = require("triple-beam");
const axios_1 = __importDefault(require("axios"));
const pino_abstract_transport_1 = __importDefault(require("pino-abstract-transport"));
class GeneralLogger {
    constructor(opts) {
        this.logEndpoint = opts.apiLogEndpoint ? opts.apiLogEndpoint : "log";
        this.batchCount = opts.batchCount ? opts.batchCount : 20;
        this.batchInterval = opts.batchInterval ? opts.batchInterval : 5000;
        this.axiosInstance = axios_1.default.create({
            baseURL: opts.apiBaseUrl,
            headers: { "x-api-key": opts.apiKey },
        });
        this.batchOptions = [];
        this.batchTimeoutID = 0;
        this.batchCallback = () => { };
    }
    _doBatch(options, callback) {
        this.batchOptions.push(options);
        if (this.batchOptions.length === 1) {
            // First message stored, it's time to start the timeout!
            const me = this;
            this.batchCallback = callback;
            this.batchTimeoutID = setTimeout(function () {
                // timeout is reached, send all messages to endpoint
                me.batchTimeoutID = 0;
                me._doBatchRequest(me.batchCallback);
            }, this.batchInterval);
        }
        if (this.batchOptions.length === this.batchCount) {
            // max batch count is reached, send all messages to endpoint
            this._doBatchRequest(this.batchCallback);
        }
    }
    _doBatchRequest(callback) {
        if (this.batchTimeoutID) {
            clearTimeout(this.batchTimeoutID);
            this.batchTimeoutID = 0;
        }
        const batchOptionsCopy = this.batchOptions.slice();
        this.batchOptions = [];
        this._doRequest(batchOptionsCopy, callback);
    }
    _doRequest(options, callback) {
        this.axiosInstance
            .post(this.logEndpoint, { logs: options })
            .then(function (response) {
            callback({ response });
        })
            .catch(function (error) {
            callback({ error });
        });
    }
}
class LogserverTransport extends winston_transport_1.default {
    constructor(opts) {
        super(opts);
        this.application = opts.application;
        this.environment = opts.environment;
        this.service = opts.service;
        this.host = opts.host;
        this.version = opts.version;
        this.generalLogger = new GeneralLogger(opts);
    }
    _logTransform(info) {
        for (let key of Object.keys(info)) {
            if (!info[key])
                delete info[key];
            if (typeof info[key] === "object") {
                info[key] = JSON.stringify(info[key]);
            }
        }
        return {
            ...info,
            timestamp: info.timestamp ? info.timestamp : new Date().toISOString(),
            version: info.version ? info.version : this.version,
            service: info.service ? info.service : this.service,
            application: info.application ? info.application : this.application,
            environment: info.environment ? info.environment : this.environment,
            logLevel: info[triple_beam_1.LEVEL],
            host: info.host ? info.host : this.host,
            message: info.message ? info.message : info[triple_beam_1.MESSAGE],
        };
    }
    log(info, callback) {
        this.generalLogger._doBatch(this._logTransform(info), (options) => {
            if (options.error) {
                this.emit("warn", options.error.message);
            }
            else if (options.response) {
                if (options.response.data.success) {
                    this.emit("logged", info);
                }
                else {
                    this.emit("warn", options.response.data.message);
                }
            }
        });
        if (callback) {
            setImmediate(callback);
        }
    }
}
exports.LogserverTransport = LogserverTransport;
const levels = {
    10: "trace",
    20: "debug",
    30: "info",
    40: "warn",
    50: "error",
    60: "fatal",
};
let _logTransform = (info, opts) => {
    for (let key of Object.keys(info)) {
        if (!info[key])
            delete info[key];
        if (typeof info[key] === "object") {
            info[key] = JSON.stringify(info[key]);
        }
    }
    if (info.time)
        info.timestamp = new Date(info.time).toISOString();
    return {
        ...info,
        timestamp: info.timestamp ? info.timestamp : new Date().toISOString(),
        version: info.version ? info.version : opts.version,
        service: info.service ? info.service : opts.service,
        application: info.application ? info.application : opts.application,
        environment: info.environment ? info.environment : opts.environment,
        logLevel: info.level
            ? typeof info.level == "string"
                ? info.level
                : levels[info.level]
            : "",
        host: info.host ? info.host : opts.host,
        message: info.msg,
    };
};
async function default_1(opts) {
    const generalLogger = new GeneralLogger(opts);
    return (0, pino_abstract_transport_1.default)(async function (source) {
        for await (const obj of source) {
            if (!obj) {
                return;
            }
            generalLogger._doBatch(_logTransform(obj, opts), (options) => {
                if (options.error) {
                    console.warn("PINO LOGSERVER LOGGER ERROR: " + options.error.message);
                }
                else if (options.response) {
                    if (!options.response.data.success) {
                        console.warn("PINO LOGSERVER LOGGER ERROR: " + options.response.data.message);
                    }
                }
            });
        }
    });
}
exports.default = default_1;
