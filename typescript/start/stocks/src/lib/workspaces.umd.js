(function (global, factory) {
	typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
	typeof define === 'function' && define.amd ? define(factory) :
	(global = typeof globalThis !== 'undefined' ? globalThis : global || self, global.workspaces = factory());
})(this, (function () { 'use strict';

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


	var CallbackFactory = /*@__PURE__*/getDefaultExportFromCjs(lib);

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
	Decoder.dict;
	/** See `Decoder.optional` */
	var optional = Decoder.optional;
	/** See `Decoder.oneOf` */
	var oneOf = Decoder.oneOf;
	/** See `Decoder.union` */
	Decoder.union;
	/** See `Decoder.intersection` */
	var intersection = Decoder.intersection;
	/** See `Decoder.withDefault` */
	Decoder.withDefault;
	/** See `Decoder.valueAt` */
	Decoder.valueAt;
	/** See `Decoder.succeed` */
	Decoder.succeed;
	/** See `Decoder.fail` */
	Decoder.fail;
	/** See `Decoder.lazy` */
	var lazy = Decoder.lazy;

	const nonEmptyStringDecoder = string().where((s) => s.length > 0, "Expected a non-empty string");
	const nonNegativeNumberDecoder = number().where((num) => num >= 0, "Expected a non-negative number");
	const positiveNumberDecoder = number().where((num) => num > 0, "Expected a positive number");
	const windowDragModeDecoder = oneOf(constant("keepInside"), constant("autoEject"));
	const isWindowInSwimlaneResultDecoder = object({
	    inWorkspace: boolean()
	});
	const allParentDecoder = oneOf(constant("workspace"), constant("row"), constant("column"), constant("group"));
	const subParentDecoder = oneOf(constant("row"), constant("column"), constant("group"));
	const frameStateDecoder = oneOf(constant("maximized"), constant("minimized"), constant("normal"));
	const loadingAnimationTypeDecoder = oneOf(constant("workspace"));
	const checkThrowCallback = (callback, allowUndefined) => {
	    const argumentType = typeof callback;
	    if (allowUndefined && argumentType !== "function" && argumentType !== "undefined") {
	        throw new Error(`Provided argument must be either undefined or of type function, provided: ${argumentType}`);
	    }
	    if (!allowUndefined && argumentType !== "function") {
	        throw new Error(`Provided argument must be of type function, provided: ${argumentType}`);
	    }
	};
	const workspaceBuilderCreateConfigDecoder = optional(object({
	    saveLayout: optional(boolean())
	}));
	const deleteLayoutConfigDecoder = object({
	    name: nonEmptyStringDecoder
	});
	const windowDefinitionConfigDecoder = object({
	    minWidth: optional(number()),
	    maxWidth: optional(number()),
	    minHeight: optional(number()),
	    maxHeight: optional(number()),
	    allowExtract: optional(boolean()),
	    allowReorder: optional(boolean()),
	    showCloseButton: optional(boolean())
	});
	const groupDefinitionConfigDecoder = object({
	    minWidth: optional(number()),
	    maxWidth: optional(number()),
	    minHeight: optional(number()),
	    maxHeight: optional(number()),
	    allowExtract: optional(boolean()),
	    allowReorder: optional(boolean()),
	    allowDrop: optional(boolean()),
	    allowDropHeader: optional(boolean()),
	    allowDropLeft: optional(boolean()),
	    allowDropRight: optional(boolean()),
	    allowDropTop: optional(boolean()),
	    allowDropBottom: optional(boolean()),
	    showMaximizeButton: optional(boolean()),
	    showEjectButton: optional(boolean()),
	    showAddWindowButton: optional(boolean())
	});
	const rowDefinitionConfigDecoder = object({
	    minHeight: optional(number()),
	    maxHeight: optional(number()),
	    allowDrop: optional(boolean()),
	    allowSplitters: optional(boolean()),
	    isPinned: optional(boolean()),
	    maximizationBoundary: optional(boolean())
	});
	const columnDefinitionConfigDecoder = object({
	    minWidth: optional(number()),
	    maxWidth: optional(number()),
	    allowDrop: optional(boolean()),
	    allowSplitters: optional(boolean()),
	    isPinned: optional(boolean()),
	    maximizationBoundary: optional(boolean())
	});
	const swimlaneWindowDefinitionDecoder = object({
	    type: optional(constant("window")),
	    appName: optional(nonEmptyStringDecoder),
	    windowId: optional(nonEmptyStringDecoder),
	    context: optional(anyJson()),
	    config: optional(windowDefinitionConfigDecoder)
	});
	const strictSwimlaneWindowDefinitionDecoder = object({
	    type: constant("window"),
	    appName: optional(nonEmptyStringDecoder),
	    windowId: optional(nonEmptyStringDecoder),
	    context: optional(anyJson()),
	    config: optional(windowDefinitionConfigDecoder)
	});
	const parentDefinitionDecoder = optional(object({
	    type: optional(subParentDecoder),
	    children: optional(lazy(() => array(oneOf(swimlaneWindowDefinitionDecoder, parentDefinitionDecoder)))),
	    config: optional(anyJson())
	}));
	const strictColumnDefinitionDecoder = object({
	    type: constant("column"),
	    children: optional(lazy(() => array(oneOf(strictSwimlaneWindowDefinitionDecoder, strictParentDefinitionDecoder)))),
	    config: optional(columnDefinitionConfigDecoder)
	});
	const strictRowDefinitionDecoder = object({
	    type: constant("row"),
	    children: optional(lazy(() => array(oneOf(strictSwimlaneWindowDefinitionDecoder, strictParentDefinitionDecoder)))),
	    config: optional(rowDefinitionConfigDecoder)
	});
	const strictGroupDefinitionDecoder = object({
	    type: constant("group"),
	    children: optional(lazy(() => array(oneOf(strictSwimlaneWindowDefinitionDecoder, strictParentDefinitionDecoder)))),
	    config: optional(groupDefinitionConfigDecoder)
	});
	const strictParentDefinitionDecoder = oneOf(strictGroupDefinitionDecoder, strictColumnDefinitionDecoder, strictRowDefinitionDecoder);
	oneOf(string().where((s) => s.toLowerCase() === "maximized", "Expected a case insensitive variation of 'maximized'"), string().where((s) => s.toLowerCase() === "normal", "Expected a case insensitive variation of 'normal'"));
	const newFrameConfigDecoder = object({
	    bounds: optional(object({
	        left: optional(number()),
	        top: optional(number()),
	        width: optional(nonNegativeNumberDecoder),
	        height: optional(nonNegativeNumberDecoder)
	    })),
	    frameId: optional(nonEmptyStringDecoder)
	});
	const loadingStrategyDecoder = oneOf(constant("direct"), constant("delayed"), constant("lazy"));
	const restoreWorkspaceConfigDecoder = optional(object({
	    app: optional(nonEmptyStringDecoder),
	    context: optional(anyJson()),
	    loadingStrategy: optional(loadingStrategyDecoder),
	    title: optional(nonEmptyStringDecoder),
	    reuseWorkspaceId: optional(nonEmptyStringDecoder),
	    frameId: optional(nonEmptyStringDecoder),
	    applicationName: optional(nonEmptyStringDecoder),
	    lockdown: optional(boolean()),
	    activateFrame: optional(boolean()),
	    newFrame: optional(oneOf(newFrameConfigDecoder, boolean())),
	    noTabHeader: optional(boolean()),
	    inMemoryLayout: optional(boolean()),
	    icon: optional(nonEmptyStringDecoder),
	    isPinned: optional(boolean()),
	    isSelected: optional(boolean()),
	    positionIndex: optional(nonNegativeNumberDecoder),
	    allowSystemHibernation: optional(boolean())
	}));
	const openWorkspaceConfigDecoder = object({
	    name: nonEmptyStringDecoder,
	    restoreOptions: optional(restoreWorkspaceConfigDecoder)
	});
	const workspaceDefinitionDecoder = object({
	    children: optional(array(oneOf(swimlaneWindowDefinitionDecoder, strictParentDefinitionDecoder))),
	    context: optional(anyJson()),
	    config: optional(object({
	        title: optional(nonEmptyStringDecoder),
	        position: optional(nonNegativeNumberDecoder),
	        isFocused: optional(boolean()),
	        noTabHeader: optional(boolean()),
	        reuseWorkspaceId: optional(nonEmptyStringDecoder),
	        loadingStrategy: optional(loadingStrategyDecoder),
	        allowDrop: optional(boolean()),
	        allowDropLeft: optional(boolean()),
	        allowDropTop: optional(boolean()),
	        allowDropRight: optional(boolean()),
	        allowDropBottom: optional(boolean()),
	        allowSystemHibernation: optional(boolean()),
	        allowExtract: optional(boolean()),
	        allowWindowReorder: optional(boolean()),
	        showSaveButton: optional(boolean()),
	        allowWorkspaceTabReorder: optional(boolean()),
	        allowWorkspaceTabExtract: optional(boolean()),
	        showCloseButton: optional(boolean()),
	        allowSplitters: optional(boolean()),
	        showWindowCloseButtons: optional(boolean()),
	        showEjectButtons: optional(boolean()),
	        showAddWindowButtons: optional(boolean()),
	        icon: optional(nonEmptyStringDecoder),
	        isPinned: optional(boolean()),
	        isSelected: optional(boolean()),
	        positionIndex: optional(nonNegativeNumberDecoder),
	        windowDragMode: optional(windowDragModeDecoder)
	    })),
	    frame: optional(object({
	        activate: optional(boolean()),
	        reuseFrameId: optional(nonEmptyStringDecoder),
	        applicationName: optional(nonEmptyStringDecoder),
	        newFrame: optional(oneOf(boolean(), newFrameConfigDecoder))
	    }))
	});
	const workspaceSelectorDecoder = object({
	    workspaceId: nonEmptyStringDecoder
	});
	const restoreWorkspaceDefinitionDecoder = object({
	    name: nonEmptyStringDecoder,
	    restoreOptions: optional(restoreWorkspaceConfigDecoder)
	});
	const emptyFrameDefinitionDecoder = optional(object({
	    applicationName: optional(string()),
	    frameConfig: optional(newFrameConfigDecoder),
	    context: optional(object()),
	    layoutComponentId: optional(nonEmptyStringDecoder)
	}));
	const frameInitConfigDecoder = object({
	    workspaces: array(oneOf(optional(workspaceDefinitionDecoder), optional(restoreWorkspaceDefinitionDecoder)))
	});
	const frameInitProtocolConfigDecoder = object({
	    frameId: nonEmptyStringDecoder,
	    workspaces: array(oneOf(workspaceDefinitionDecoder, restoreWorkspaceDefinitionDecoder))
	});
	const builderConfigDecoder = object({
	    type: allParentDecoder,
	    definition: optional(oneOf(workspaceDefinitionDecoder, parentDefinitionDecoder))
	});
	const workspaceCreateConfigDecoder = intersection(workspaceDefinitionDecoder, object({
	    saveConfig: optional(object({
	        saveLayout: optional(boolean())
	    }))
	}));
	const getFrameSummaryConfigDecoder = object({
	    itemId: nonEmptyStringDecoder
	});
	const frameInitializationContextDecoder = object({
	    context: optional(object())
	});
	const frameSummaryDecoder = object({
	    id: nonEmptyStringDecoder,
	    isFocused: optional(boolean()),
	    isInitialized: optional(boolean()),
	    initializationContext: optional(frameInitializationContextDecoder)
	});
	object({
	    type: subParentDecoder,
	    id: nonEmptyStringDecoder,
	    frameId: nonEmptyStringDecoder,
	    workspaceId: nonEmptyStringDecoder,
	    positionIndex: number()
	});
	const eventTypeDecoder = oneOf(constant("frame"), constant("workspace"), constant("container"), constant("window"));
	const streamRequestArgumentsDecoder = object({
	    type: eventTypeDecoder,
	    branch: nonEmptyStringDecoder
	});
	const workspaceEventActionDecoder = oneOf(constant("opened"), constant("closing"), constant("closed"), constant("focus"), constant("added"), constant("loaded"), constant("removed"), constant("childrenUpdate"), constant("containerChange"), constant("maximized"), constant("restored"), constant("minimized"), constant("normal"), constant("selected"), constant("lock-configuration-changed"), constant("hibernated"), constant("resumed"));
	const workspaceConfigResultDecoder = object({
	    frameId: nonEmptyStringDecoder,
	    title: nonEmptyStringDecoder,
	    positionIndex: nonNegativeNumberDecoder,
	    name: nonEmptyStringDecoder,
	    layoutName: optional(nonEmptyStringDecoder),
	    isHibernated: optional(boolean()),
	    isSelected: optional(boolean()),
	    allowDrop: optional(boolean()),
	    allowSystemHibernation: optional(boolean()),
	    allowExtract: optional(boolean()),
	    allowWindowReorder: optional(boolean()),
	    allowSplitters: optional(boolean()),
	    showCloseButton: optional(boolean()),
	    showSaveButton: optional(boolean()),
	    allowWorkspaceTabReorder: optional(boolean()),
	    allowWorkspaceTabExtract: optional(boolean()),
	    allowDropLeft: optional(boolean()),
	    allowDropTop: optional(boolean()),
	    allowDropRight: optional(boolean()),
	    allowDropBottom: optional(boolean()),
	    minWidth: optional(number()),
	    maxWidth: optional(number()),
	    minHeight: optional(number()),
	    maxHeight: optional(number()),
	    showAddWindowButtons: optional(boolean()),
	    showEjectButtons: optional(boolean()),
	    showWindowCloseButtons: optional(boolean()),
	    widthInPx: optional(number()),
	    heightInPx: optional(number()),
	    isPinned: optional(boolean()),
	    windowDragMode: optional(windowDragModeDecoder),
	    loadingStrategy: optional(loadingStrategyDecoder)
	});
	const baseChildSnapshotConfigDecoder = object({
	    frameId: nonEmptyStringDecoder,
	    workspaceId: nonEmptyStringDecoder,
	    positionIndex: number(),
	    minWidth: optional(number()),
	    maxWidth: optional(number()),
	    minHeight: optional(number()),
	    maxHeight: optional(number())
	});
	const parentSnapshotConfigDecoder = anyJson();
	const swimlaneWindowSnapshotConfigDecoder = intersection(baseChildSnapshotConfigDecoder, object({
	    windowId: optional(nonEmptyStringDecoder),
	    isMaximized: optional(boolean()),
	    isFocused: boolean(),
	    isSelected: optional(boolean()),
	    title: optional(string()),
	    appName: optional(nonEmptyStringDecoder),
	    allowExtract: optional(boolean()),
	    allowReorder: optional(boolean()),
	    showCloseButton: optional(boolean()),
	    minWidth: optional(number()),
	    minHeight: optional(number()),
	    maxWidth: optional(number()),
	    maxHeight: optional(number()),
	    widthInPx: optional(number()),
	    heightInPx: optional(number()),
	    context: optional(anyJson())
	}));
	const customWorkspaceSubParentSnapshotDecoder = object({
	    id: optional(nonEmptyStringDecoder),
	    config: parentSnapshotConfigDecoder,
	    children: optional(lazy(() => array(customWorkspaceChildSnapshotDecoder))),
	    type: oneOf(constant("row"), constant("column"), constant("group"))
	});
	const customWorkspaceWindowSnapshotDecoder = object({
	    id: optional(nonEmptyStringDecoder),
	    config: swimlaneWindowSnapshotConfigDecoder,
	    type: constant("window")
	});
	const customWorkspaceChildSnapshotDecoder = oneOf(customWorkspaceWindowSnapshotDecoder, customWorkspaceSubParentSnapshotDecoder);
	const childSnapshotResultDecoder = customWorkspaceChildSnapshotDecoder;
	const workspaceSnapshotResultDecoder = object({
	    id: nonEmptyStringDecoder,
	    config: workspaceConfigResultDecoder,
	    children: array(childSnapshotResultDecoder),
	    frameSummary: frameSummaryDecoder,
	    context: optional(anyJson())
	});
	const windowLayoutItemDecoder = object({
	    type: constant("window"),
	    config: object({
	        appName: nonEmptyStringDecoder,
	        windowId: optional(nonEmptyStringDecoder),
	        context: optional(anyJson()),
	        url: optional(nonEmptyStringDecoder),
	        title: optional(string()),
	        allowExtract: optional(boolean()),
	        allowReorder: optional(boolean()),
	        showCloseButton: optional(boolean()),
	        minWidth: optional(number()),
	        minHeight: optional(number()),
	        maxWidth: optional(number()),
	        maxHeight: optional(number()),
	        isMaximized: optional(boolean())
	    })
	});
	const groupLayoutItemDecoder = object({
	    type: constant("group"),
	    config: anyJson(),
	    children: array(oneOf(windowLayoutItemDecoder))
	});
	const columnLayoutItemDecoder = object({
	    type: constant("column"),
	    config: anyJson(),
	    children: array(oneOf(groupLayoutItemDecoder, windowLayoutItemDecoder, lazy(() => columnLayoutItemDecoder), lazy(() => rowLayoutItemDecoder)))
	});
	const rowLayoutItemDecoder = object({
	    type: constant("row"),
	    config: anyJson(),
	    children: array(oneOf(columnLayoutItemDecoder, groupLayoutItemDecoder, windowLayoutItemDecoder, lazy(() => rowLayoutItemDecoder)))
	});
	const workspaceLayoutDecoder = object({
	    name: nonEmptyStringDecoder,
	    type: constant("Workspace"),
	    metadata: optional(anyJson()),
	    components: array(object({
	        type: constant("Workspace"),
	        application: optional(string()),
	        state: object({
	            config: anyJson(),
	            context: anyJson(),
	            children: array(oneOf(rowLayoutItemDecoder, columnLayoutItemDecoder, groupLayoutItemDecoder, windowLayoutItemDecoder))
	        })
	    }))
	});
	const workspacesImportLayoutDecoder = object({
	    layout: workspaceLayoutDecoder,
	    mode: oneOf(constant("replace"), constant("merge"))
	});
	const workspacesImportLayoutsDecoder = object({
	    layouts: array(workspaceLayoutDecoder),
	    mode: oneOf(constant("replace"), constant("merge"))
	});
	const exportedLayoutsResultDecoder = object({
	    layouts: array(workspaceLayoutDecoder)
	});
	const frameSummaryResultDecoder = object({
	    id: nonEmptyStringDecoder,
	    isFocused: optional(boolean()),
	    isInitialized: optional(boolean()),
	    initializationContext: optional(frameInitializationContextDecoder)
	});
	const frameSummariesResultDecoder = object({
	    summaries: array(frameSummaryResultDecoder)
	});
	const workspaceSummaryResultDecoder = object({
	    id: nonEmptyStringDecoder,
	    config: workspaceConfigResultDecoder
	});
	const workspaceSummariesResultDecoder = object({
	    summaries: array(workspaceSummaryResultDecoder)
	});
	const frameSnapshotResultDecoder = object({
	    id: nonEmptyStringDecoder,
	    config: anyJson(),
	    workspaces: array(workspaceSnapshotResultDecoder)
	});
	const layoutSummaryDecoder = object({
	    name: nonEmptyStringDecoder,
	    applicationName: optional(string())
	});
	const layoutSummariesDecoder = object({
	    summaries: array(layoutSummaryDecoder)
	});
	const simpleWindowOperationSuccessResultDecoder = object({
	    windowId: nonEmptyStringDecoder
	});
	const voidResultDecoder = anyJson();
	const frameStateResultDecoder = object({
	    state: frameStateDecoder
	});
	const frameBoundsDecoder = object({
	    top: number(),
	    left: number(),
	    width: nonNegativeNumberDecoder,
	    height: nonNegativeNumberDecoder
	});
	const frameBoundsResultDecoder = object({
	    bounds: frameBoundsDecoder
	});
	const getWorkspaceIconResultDecoder = object({
	    icon: optional(nonEmptyStringDecoder)
	});
	const getPlatformFrameIdResultDecoder = object({
	    id: optional(nonEmptyStringDecoder)
	});
	const operationCheckResultDecoder = object({
	    isSupported: boolean()
	});
	const resizeConfigDecoder = object({
	    width: optional(positiveNumberDecoder),
	    height: optional(positiveNumberDecoder),
	    relative: optional(boolean())
	});
	const moveConfigDecoder = object({
	    top: optional(number()),
	    left: optional(number()),
	    relative: optional(boolean())
	});
	const simpleItemConfigDecoder = object({
	    itemId: nonEmptyStringDecoder
	});
	const frameSnapshotConfigDecoder = object({
	    itemId: nonEmptyStringDecoder,
	    excludeIds: optional(boolean())
	});
	const frameStateConfigDecoder = object({
	    frameId: nonEmptyStringDecoder,
	    requestedState: frameStateDecoder
	});
	const setItemTitleConfigDecoder = object({
	    itemId: nonEmptyStringDecoder,
	    title: nonEmptyStringDecoder
	});
	const moveWindowConfigDecoder = object({
	    itemId: nonEmptyStringDecoder,
	    containerId: nonEmptyStringDecoder
	});
	const resizeItemConfigDecoder = intersection(simpleItemConfigDecoder, resizeConfigDecoder);
	const setMaximizationBoundaryConfigDecoder = object({
	    itemId: nonEmptyStringDecoder,
	    enabled: boolean()
	});
	const moveFrameConfigDecoder = intersection(simpleItemConfigDecoder, moveConfigDecoder);
	object({
	    id: nonEmptyStringDecoder,
	    type: subParentDecoder
	});
	const addWindowConfigDecoder = object({
	    definition: swimlaneWindowDefinitionDecoder,
	    parentId: nonEmptyStringDecoder,
	    parentType: allParentDecoder
	});
	const addContainerConfigDecoder = object({
	    definition: strictParentDefinitionDecoder,
	    parentId: nonEmptyStringDecoder,
	    parentType: allParentDecoder
	});
	const addItemResultDecoder = object({
	    itemId: nonEmptyStringDecoder,
	    windowId: optional(nonEmptyStringDecoder)
	});
	const pingResultDecoder = object({
	    live: boolean()
	});
	const bundleWorkspaceConfigDecoder = object({
	    type: oneOf(constant("row"), constant("column")),
	    workspaceId: nonEmptyStringDecoder
	});
	const bundleItemConfigDecoder = object({
	    type: oneOf(constant("row"), constant("column")),
	    itemId: nonEmptyStringDecoder
	});
	const containerSummaryResultDecoder = object({
	    itemId: nonEmptyStringDecoder,
	    config: parentSnapshotConfigDecoder
	});
	const frameStreamDataDecoder = object({
	    frameSummary: frameSummaryDecoder,
	    frameBounds: optional(frameBoundsDecoder)
	});
	const workspaceStreamDataDecoder = object({
	    workspaceSummary: workspaceSummaryResultDecoder,
	    frameSummary: frameSummaryDecoder,
	    workspaceSnapshot: optional(workspaceSnapshotResultDecoder),
	    frameBounds: optional(frameBoundsDecoder)
	});
	const containerStreamDataDecoder = object({
	    containerSummary: containerSummaryResultDecoder
	});
	const windowStreamDataDecoder = object({
	    windowSummary: object({
	        itemId: nonEmptyStringDecoder,
	        parentId: nonEmptyStringDecoder,
	        config: swimlaneWindowSnapshotConfigDecoder
	    })
	});
	const workspaceLayoutSaveConfigDecoder = object({
	    name: nonEmptyStringDecoder,
	    workspaceId: nonEmptyStringDecoder,
	    saveContext: optional(boolean()),
	    allowMultiple: optional(boolean()),
	    metadata: optional(object())
	});
	const workspaceLockConfigDecoder = object({
	    allowDrop: optional(boolean()),
	    allowDropLeft: optional(boolean()),
	    allowDropTop: optional(boolean()),
	    allowDropRight: optional(boolean()),
	    allowDropBottom: optional(boolean()),
	    allowSystemHibernation: optional(boolean()),
	    allowExtract: optional(boolean()),
	    allowWindowReorder: optional(boolean()),
	    allowSplitters: optional(boolean()),
	    showCloseButton: optional(boolean()),
	    showSaveButton: optional(boolean()),
	    allowWorkspaceTabReorder: optional(boolean()),
	    allowWorkspaceTabExtract: optional(boolean()),
	    showWindowCloseButtons: optional(boolean()),
	    showAddWindowButtons: optional(boolean()),
	    showEjectButtons: optional(boolean()),
	});
	const lockWorkspaceDecoder = object({
	    workspaceId: nonEmptyStringDecoder,
	    config: optional(workspaceLockConfigDecoder)
	});
	const windowLockConfigDecoder = object({
	    allowExtract: optional(boolean()),
	    allowReorder: optional(boolean()),
	    showCloseButton: optional(boolean())
	});
	const elementResizeConfigDecoder = object({
	    width: optional(nonNegativeNumberDecoder),
	    height: optional(nonNegativeNumberDecoder)
	});
	const lockWindowDecoder = object({
	    windowPlacementId: nonEmptyStringDecoder,
	    config: optional(windowLockConfigDecoder)
	});
	const rowLockConfigDecoder = object({
	    allowDrop: optional(boolean()),
	    allowSplitters: optional(boolean()),
	});
	const columnLockConfigDecoder = object({
	    allowDrop: optional(boolean()),
	    allowSplitters: optional(boolean()),
	});
	const groupLockConfigDecoder = object({
	    allowExtract: optional(boolean()),
	    allowReorder: optional(boolean()),
	    allowDrop: optional(boolean()),
	    allowDropLeft: optional(boolean()),
	    allowDropRight: optional(boolean()),
	    allowDropTop: optional(boolean()),
	    allowDropBottom: optional(boolean()),
	    allowDropHeader: optional(boolean()),
	    showMaximizeButton: optional(boolean()),
	    showEjectButton: optional(boolean()),
	    showAddWindowButton: optional(boolean()),
	});
	const lockRowDecoder = object({
	    itemId: nonEmptyStringDecoder,
	    type: constant("row"),
	    config: optional(rowLockConfigDecoder)
	});
	const lockColumnDecoder = object({
	    itemId: nonEmptyStringDecoder,
	    type: constant("column"),
	    config: optional(columnLockConfigDecoder)
	});
	const lockGroupDecoder = object({
	    itemId: nonEmptyStringDecoder,
	    type: constant("group"),
	    config: optional(groupLockConfigDecoder)
	});
	const lockContainerDecoder = oneOf(lockRowDecoder, lockColumnDecoder, lockGroupDecoder);
	const pinWorkspaceDecoder = object({
	    workspaceId: nonEmptyStringDecoder,
	    icon: optional(nonEmptyStringDecoder)
	});
	const setWorkspaceIconDecoder = object({
	    workspaceId: nonEmptyStringDecoder,
	    icon: optional(nonEmptyStringDecoder)
	});
	const workspacePinOptionsDecoder = optional(object({
	    icon: optional(nonEmptyStringDecoder)
	}));
	const shortcutConfigDecoder = object({
	    shortcut: nonEmptyStringDecoder,
	    frameId: nonEmptyStringDecoder
	});
	const shortcutClickedDataDecoder = object({
	    shortcut: nonEmptyStringDecoder,
	    frameId: nonEmptyStringDecoder
	});
	const setMaximizationBoundaryAPIConfigDecoder = object({
	    enabled: boolean()
	});
	const loadingAnimationConfigDecoder = object({
	    itemId: nonEmptyStringDecoder,
	    type: loadingAnimationTypeDecoder
	});
	const operationCheckConfigDecoder = object({
	    operation: nonEmptyStringDecoder
	});
	const setWindowDragModeDecoder = object({
	    itemId: nonEmptyStringDecoder,
	    dragMode: windowDragModeDecoder
	});
	const setLoadingStrategyDecoder = object({
	    itemId: nonEmptyStringDecoder,
	    strategy: loadingStrategyDecoder
	});

	const webPlatformMethodName = "T42.Web.Platform.Control";
	const webPlatformWspStreamName = "T42.Web.Platform.WSP.Stream";
	const OUTGOING_METHODS = {
	    control: { name: "T42.Workspaces.Control", isStream: false },
	    frameStream: { name: "T42.Workspaces.Stream.Frame", isStream: true },
	    workspaceStream: { name: "T42.Workspaces.Stream.Workspace", isStream: true },
	    containerStream: { name: "T42.Workspaces.Stream.Container", isStream: true },
	    windowStream: { name: "T42.Workspaces.Stream.Window", isStream: true }
	};
	const INCOMING_METHODS = {
	    control: { name: "T42.Workspaces.Client.Control", isStream: false },
	};
	const STREAMS = {
	    frame: { name: "T42.Workspaces.Stream.Frame", payloadDecoder: frameStreamDataDecoder },
	    workspace: { name: "T42.Workspaces.Stream.Workspace", payloadDecoder: workspaceStreamDataDecoder },
	    container: { name: "T42.Workspaces.Stream.Container", payloadDecoder: containerStreamDataDecoder },
	    window: { name: "T42.Workspaces.Stream.Window", payloadDecoder: windowStreamDataDecoder }
	};
	const CLIENT_OPERATIONS = {
	    shortcutClicked: { name: "shortcutClicked", argsDecoder: shortcutClickedDataDecoder, resultDecoder: voidResultDecoder },
	};
	const OPERATIONS = {
	    ping: { name: "ping", resultDecoder: pingResultDecoder },
	    isWindowInWorkspace: { name: "isWindowInWorkspace", argsDecoder: simpleItemConfigDecoder, resultDecoder: isWindowInSwimlaneResultDecoder },
	    createWorkspace: { name: "createWorkspace", resultDecoder: workspaceSnapshotResultDecoder, argsDecoder: workspaceCreateConfigDecoder },
	    createFrame: { name: "createFrame", resultDecoder: frameSummaryResultDecoder, argsDecoder: emptyFrameDefinitionDecoder },
	    initFrame: { name: "initFrame", resultDecoder: voidResultDecoder, argsDecoder: frameInitProtocolConfigDecoder },
	    getAllFramesSummaries: { name: "getAllFramesSummaries", resultDecoder: frameSummariesResultDecoder },
	    getFrameSummary: { name: "getFrameSummary", resultDecoder: frameSummaryDecoder, argsDecoder: getFrameSummaryConfigDecoder },
	    getAllWorkspacesSummaries: { name: "getAllWorkspacesSummaries", resultDecoder: workspaceSummariesResultDecoder },
	    getWorkspaceSnapshot: { name: "getWorkspaceSnapshot", resultDecoder: workspaceSnapshotResultDecoder, argsDecoder: simpleItemConfigDecoder },
	    getAllLayoutsSummaries: { name: "getAllLayoutsSummaries", resultDecoder: layoutSummariesDecoder },
	    openWorkspace: { name: "openWorkspace", argsDecoder: openWorkspaceConfigDecoder, resultDecoder: workspaceSnapshotResultDecoder },
	    deleteLayout: { name: "deleteLayout", resultDecoder: voidResultDecoder, argsDecoder: deleteLayoutConfigDecoder },
	    saveLayout: { name: "saveLayout", resultDecoder: workspaceLayoutDecoder, argsDecoder: workspaceLayoutSaveConfigDecoder },
	    importLayout: { name: "importLayout", resultDecoder: voidResultDecoder, argsDecoder: workspacesImportLayoutDecoder },
	    importLayouts: { name: "importLayouts", resultDecoder: voidResultDecoder, argsDecoder: workspacesImportLayoutsDecoder },
	    exportAllLayouts: { name: "exportAllLayouts", resultDecoder: exportedLayoutsResultDecoder },
	    restoreItem: { name: "restoreItem", argsDecoder: simpleItemConfigDecoder, resultDecoder: voidResultDecoder },
	    maximizeItem: { name: "maximizeItem", argsDecoder: simpleItemConfigDecoder, resultDecoder: voidResultDecoder },
	    focusItem: { name: "focusItem", argsDecoder: simpleItemConfigDecoder, resultDecoder: voidResultDecoder },
	    closeItem: { name: "closeItem", argsDecoder: simpleItemConfigDecoder, resultDecoder: voidResultDecoder },
	    resizeItem: { name: "resizeItem", argsDecoder: resizeItemConfigDecoder, resultDecoder: voidResultDecoder },
	    setMaximizationBoundary: { name: "setMaximizationBoundary", argsDecoder: setMaximizationBoundaryConfigDecoder, resultDecoder: voidResultDecoder },
	    changeFrameState: { name: "changeFrameState", argsDecoder: frameStateConfigDecoder, resultDecoder: voidResultDecoder },
	    getFrameState: { name: "getFrameState", argsDecoder: simpleItemConfigDecoder, resultDecoder: frameStateResultDecoder },
	    getFrameBounds: { name: "getFrameBounds", argsDecoder: simpleItemConfigDecoder, resultDecoder: frameBoundsResultDecoder },
	    moveFrame: { name: "moveFrame", argsDecoder: moveFrameConfigDecoder, resultDecoder: voidResultDecoder },
	    getFrameSnapshot: { name: "getFrameSnapshot", argsDecoder: frameSnapshotConfigDecoder, resultDecoder: frameSnapshotResultDecoder },
	    forceLoadWindow: { name: "forceLoadWindow", argsDecoder: simpleItemConfigDecoder, resultDecoder: simpleWindowOperationSuccessResultDecoder },
	    ejectWindow: { name: "ejectWindow", argsDecoder: simpleItemConfigDecoder, resultDecoder: simpleWindowOperationSuccessResultDecoder },
	    setItemTitle: { name: "setItemTitle", argsDecoder: setItemTitleConfigDecoder, resultDecoder: voidResultDecoder },
	    moveWindowTo: { name: "moveWindowTo", argsDecoder: moveWindowConfigDecoder, resultDecoder: voidResultDecoder },
	    addWindow: { name: "addWindow", argsDecoder: addWindowConfigDecoder, resultDecoder: addItemResultDecoder },
	    addContainer: { name: "addContainer", argsDecoder: addContainerConfigDecoder, resultDecoder: addItemResultDecoder },
	    bundleWorkspace: { name: "bundleWorkspace", argsDecoder: bundleWorkspaceConfigDecoder, resultDecoder: voidResultDecoder },
	    bundleItem: { name: "bundleItem", argsDecoder: bundleItemConfigDecoder, resultDecoder: voidResultDecoder },
	    hibernateWorkspace: { name: "hibernateWorkspace", argsDecoder: workspaceSelectorDecoder, resultDecoder: voidResultDecoder },
	    resumeWorkspace: { name: "resumeWorkspace", argsDecoder: workspaceSelectorDecoder, resultDecoder: voidResultDecoder },
	    lockWorkspace: { name: "lockWorkspace", argsDecoder: lockWorkspaceDecoder, resultDecoder: voidResultDecoder },
	    lockWindow: { name: "lockWindow", argsDecoder: lockWindowDecoder, resultDecoder: voidResultDecoder },
	    lockContainer: { name: "lockContainer", argsDecoder: lockContainerDecoder, resultDecoder: voidResultDecoder },
	    pinWorkspace: { name: "pinWorkspace", argsDecoder: pinWorkspaceDecoder, resultDecoder: voidResultDecoder },
	    unpinWorkspace: { name: "unpinWorkspace", argsDecoder: workspaceSelectorDecoder, resultDecoder: voidResultDecoder },
	    getWorkspaceIcon: { name: "getWorkspaceIcon", argsDecoder: workspaceSelectorDecoder, resultDecoder: getWorkspaceIconResultDecoder },
	    setWorkspaceIcon: { name: "setWorkspaceIcon", argsDecoder: setWorkspaceIconDecoder, resultDecoder: voidResultDecoder },
	    registerShortcut: { name: "registerShortcut", argsDecoder: shortcutConfigDecoder, resultDecoder: voidResultDecoder },
	    unregisterShortcut: { name: "unregisterShortcut", argsDecoder: shortcutConfigDecoder, resultDecoder: voidResultDecoder },
	    showLoadingAnimation: { name: "showLoadingAnimation", argsDecoder: loadingAnimationConfigDecoder, resultDecoder: voidResultDecoder },
	    hideLoadingAnimation: { name: "hideLoadingAnimation", argsDecoder: loadingAnimationConfigDecoder, resultDecoder: voidResultDecoder },
	    getPlatformFrameId: { name: "getPlatformFrameId", resultDecoder: getPlatformFrameIdResultDecoder },
	    operationCheck: { name: "operationCheck", argsDecoder: operationCheckConfigDecoder, resultDecoder: operationCheckResultDecoder },
	    setWindowDragMode: { name: "setWindowDragMode", argsDecoder: setWindowDragModeDecoder, resultDecoder: voidResultDecoder },
	    setLoadingStrategy: { name: "setLoadingStrategy", argsDecoder: setLoadingStrategyDecoder, resultDecoder: voidResultDecoder }
	};

	class PromiseWrapper {
	    resolve;
	    reject;
	    promise;
	    constructor() {
	        this.promise = new Promise((res, rej) => {
	            this.resolve = res;
	            this.reject = rej;
	        });
	    }
	}

	class Bridge {
	    transport;
	    registry;
	    activeSubscriptions = [];
	    pendingSubScriptions = [];
	    constructor(transport, registry) {
	        this.transport = transport;
	        this.registry = registry;
	    }
	    async createCoreEventSubscription() {
	        await this.transport.coreSubscriptionReady(this.handleCoreEvent.bind(this));
	    }
	    handleCoreSubscription(config) {
	        const registryKey = `${config.eventType}-${config.action}`;
	        const scope = config.scope;
	        const scopeId = config.scopeId;
	        return this.registry.add(registryKey, (args) => {
	            const scopeConfig = {
	                type: scope,
	                id: scopeId
	            };
	            const receivedIds = {
	                frame: args.frameSummary?.id || args.windowSummary?.config.frameId,
	                workspace: args.workspaceSummary?.id || args.windowSummary?.config.workspaceId,
	                container: args.containerSummary?.itemId,
	                window: args.windowSummary?.itemId
	            };
	            const shouldInvokeCallback = this.checkScopeMatch(scopeConfig, receivedIds);
	            if (!shouldInvokeCallback) {
	                return;
	            }
	            config.callback(args);
	        });
	    }
	    async send(operationName, operationArgs) {
	        const operationDefinition = Object.values(OPERATIONS).find((operation) => operation.name === operationName);
	        if (!operationDefinition) {
	            throw new Error(`Cannot find definition for operation name: ${operationName}`);
	        }
	        if (operationDefinition.argsDecoder) {
	            try {
	                operationDefinition.argsDecoder.runWithException(operationArgs);
	            }
	            catch (error) {
	                throw new Error(`Unexpected internal outgoing validation error: ${error.message}, for input: ${JSON.stringify(error.input)}, for operation ${operationName}`);
	            }
	        }
	        try {
	            const operationResult = await this.transport.transmitControl(operationDefinition.name, operationArgs);
	            operationDefinition.resultDecoder.runWithException(operationResult);
	            return operationResult;
	        }
	        catch (error) {
	            if (error.kind) {
	                throw new Error(`Unexpected internal incoming validation error: ${error.message}, for input: ${JSON.stringify(error.input)}, for operation ${operationName}`);
	            }
	            throw new Error(error.message);
	        }
	    }
	    async subscribe(config) {
	        const pendingSub = this.getPendingSubscription(config);
	        if (pendingSub) {
	            await pendingSub.promise;
	        }
	        let activeSub = this.getActiveSubscription(config);
	        const registryKey = this.getRegistryKey(config);
	        if (!activeSub) {
	            const pendingPromise = new PromiseWrapper();
	            const pendingSubscription = {
	                streamType: config.eventType,
	                level: config.scope,
	                levelId: config.scopeId,
	                promise: pendingPromise.promise
	            };
	            this.pendingSubScriptions.push(pendingSubscription);
	            try {
	                const stream = STREAMS[config.eventType];
	                const gdSub = await this.transport.subscribe(stream.name, this.getBranchKey(config), config.eventType);
	                gdSub.onData((streamData) => {
	                    const data = streamData.data;
	                    const requestedArgumentsResult = streamRequestArgumentsDecoder.run(streamData.requestArguments);
	                    const actionResult = workspaceEventActionDecoder.run(data.action);
	                    if (!requestedArgumentsResult.ok || !actionResult.ok) {
	                        return;
	                    }
	                    const streamType = requestedArgumentsResult.result.type;
	                    const branch = requestedArgumentsResult.result.branch;
	                    const keyToExecute = `${streamType}-${branch}-${actionResult.result}`;
	                    const validatedPayload = STREAMS[streamType].payloadDecoder.run(data.payload);
	                    if (!validatedPayload.ok) {
	                        return;
	                    }
	                    this.registry.execute(keyToExecute, validatedPayload.result);
	                });
	                activeSub = {
	                    streamType: config.eventType,
	                    level: config.scope,
	                    levelId: config.scopeId,
	                    callbacksCount: 0,
	                    gdSub
	                };
	                this.activeSubscriptions.push(activeSub);
	                pendingPromise.resolve();
	            }
	            catch (error) {
	                pendingPromise.reject(error);
	                throw error;
	            }
	            finally {
	                this.removePendingSubscription(pendingSubscription);
	            }
	        }
	        const unsubscribe = this.registry.add(registryKey, config.callback);
	        ++activeSub.callbacksCount;
	        return () => {
	            unsubscribe();
	            --activeSub.callbacksCount;
	            if (activeSub.callbacksCount === 0) {
	                activeSub.gdSub.close();
	                this.activeSubscriptions.splice(this.activeSubscriptions.indexOf(activeSub), 1);
	            }
	        };
	    }
	    onOperation(callback) {
	        const wrappedCallback = (payload, caller) => {
	            const operationName = payload.operation;
	            const operationArgs = payload.data;
	            const operationDefinition = Object.values(CLIENT_OPERATIONS).find((operation) => operation.name === operationName);
	            if (!operationDefinition) {
	                throw new Error(`Cannot find definition for operation name: ${operationName}`);
	            }
	            if (operationDefinition.argsDecoder) {
	                try {
	                    operationDefinition.argsDecoder.runWithException(operationArgs);
	                }
	                catch (error) {
	                    throw new Error(`Unexpected internal outgoing validation error: ${error.message}, for input: ${JSON.stringify(error.input)}, for operation ${operationName}`);
	                }
	            }
	            callback(payload, caller);
	        };
	        return this.transport.onInternalMethodInvoked("control", wrappedCallback);
	    }
	    checkScopeMatch(scope, receivedIds) {
	        if (scope.type === "global") {
	            return true;
	        }
	        if (scope.type === "frame" && scope.id === receivedIds.frame) {
	            return true;
	        }
	        if (scope.type === "workspace" && scope.id === receivedIds.workspace) {
	            return true;
	        }
	        if (scope.type === "container" && scope.id === receivedIds.container) {
	            return true;
	        }
	        if (scope.type === "window" && scope.id === receivedIds.window) {
	            return true;
	        }
	        return false;
	    }
	    handleCoreEvent(args) {
	        const data = args.data;
	        try {
	            const verifiedAction = workspaceEventActionDecoder.runWithException(data.action);
	            const verifiedType = eventTypeDecoder.runWithException(data.type);
	            const verifiedPayload = STREAMS[verifiedType].payloadDecoder.runWithException(data.payload);
	            const registryKey = `${verifiedType}-${verifiedAction}`;
	            this.registry.execute(registryKey, verifiedPayload);
	        }
	        catch (error) {
	            console.warn(`Cannot handle event with data ${JSON.stringify(data)}, because of validation error: ${error.message}`);
	        }
	    }
	    getBranchKey(config) {
	        return config.scope === "global" ? config.scope : `${config.scope}_${config.scopeId}`;
	    }
	    getRegistryKey(config) {
	        return `${config.eventType}-${this.getBranchKey(config)}-${config.action}`;
	    }
	    getActiveSubscription(config) {
	        return this.activeSubscriptions
	            .find((activeSub) => activeSub.streamType === config.eventType &&
	            activeSub.level === config.scope &&
	            activeSub.levelId === config.scopeId);
	    }
	    getPendingSubscription(config) {
	        return this.pendingSubScriptions
	            .find((activeSub) => activeSub.streamType === config.eventType &&
	            activeSub.level === config.scope &&
	            activeSub.levelId === config.scopeId);
	    }
	    removePendingSubscription(pendingSubscription) {
	        const index = this.pendingSubScriptions.indexOf(pendingSubscription);
	        if (index >= 0) {
	            this.pendingSubScriptions.splice(index, 1);
	        }
	    }
	}

	const promisePlus = (promise, timeoutMilliseconds, timeoutMessage) => {
	    return new Promise((resolve, reject) => {
	        let promiseActive = true;
	        const timeout = setTimeout(() => {
	            if (!promiseActive) {
	                return;
	            }
	            promiseActive = false;
	            const message = timeoutMessage;
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

	const isDesktop = () => {
	    return typeof window === "undefined" ?
	        true :
	        window.glue42gd || window.iodesktop;
	};
	const browserGlobal = () => {
	    return typeof window === "undefined" ? null :
	        window.glue42core || window.iobrowser;
	};

	class InteropTransport {
	    agm;
	    registry;
	    defaultTransportTimeout = 120000;
	    coreEventMethodInitiated = false;
	    corePlatformSubPromise;
	    constructor(agm, registry) {
	        this.agm = agm;
	        this.registry = registry;
	    }
	    async initiate(actualWindowId) {
	        if (isDesktop()) {
	            await Promise.all(Object.values(OUTGOING_METHODS).map((method) => {
	                return this.verifyMethodLive(method.name);
	            }));
	            await Promise.all(Object.keys(INCOMING_METHODS).map((method) => {
	                return this.registerMethod(method);
	            }));
	            return;
	        }
	        const systemId = browserGlobal().communicationId;
	        await Promise.all([
	            this.verifyMethodLive(webPlatformMethodName, systemId),
	            this.verifyMethodLive(webPlatformWspStreamName, systemId)
	        ]);
	        await this.transmitControl("frameHello", { windowId: actualWindowId });
	    }
	    coreSubscriptionReady(eventCallback) {
	        if (!this.coreEventMethodInitiated) {
	            this.subscribePlatform(eventCallback);
	        }
	        return this.corePlatformSubPromise;
	    }
	    subscribePlatform(eventCallback) {
	        this.coreEventMethodInitiated = true;
	        const systemId = browserGlobal().communicationId;
	        this.corePlatformSubPromise = this.agm.subscribe(webPlatformWspStreamName, systemId ? { target: { instance: systemId } } : undefined);
	        this.corePlatformSubPromise
	            .then((sub) => {
	            sub.onData((data) => eventCallback(data.data));
	        });
	    }
	    async subscribe(streamName, streamBranch, streamType) {
	        const subscriptionArgs = {
	            branch: streamBranch,
	            type: streamType
	        };
	        let subscription;
	        try {
	            subscription = await this.agm.subscribe(streamName, { arguments: subscriptionArgs });
	        }
	        catch (error) {
	            const message = `Internal subscription error! Error details: stream - ${streamName}, branch: ${streamBranch}. Internal message: ${error.message}`;
	            throw new Error(message);
	        }
	        return subscription;
	    }
	    async transmitControl(operation, operationArguments) {
	        const invocationArguments = isDesktop() ? { operation, operationArguments } : { operation, domain: "workspaces", data: operationArguments };
	        const methodName = isDesktop() ? OUTGOING_METHODS.control.name : webPlatformMethodName;
	        const platformTarget = isDesktop() ? undefined : browserGlobal().communicationId;
	        let invocationResult;
	        const baseErrorMessage = `Internal Workspaces Communication Error. Attempted operation: ${JSON.stringify(invocationArguments)}. `;
	        try {
	            invocationResult = await this.agm.invoke(methodName, invocationArguments, platformTarget ? { instance: platformTarget } : "best", { methodResponseTimeoutMs: this.defaultTransportTimeout });
	            if (!invocationResult) {
	                throw new Error("Received unsupported result from GD - empty result");
	            }
	            if (!Array.isArray(invocationResult.all_return_values) || invocationResult.all_return_values.length === 0) {
	                throw new Error("Received unsupported result from GD - empty values collection");
	            }
	        }
	        catch (error) {
	            if (error && error.all_errors && error.all_errors.length) {
	                const invocationErrorMessage = error.all_errors[0].message;
	                throw new Error(`${baseErrorMessage} -> Inner message: ${invocationErrorMessage}`);
	            }
	            throw new Error(`${baseErrorMessage} -> Inner message: ${error.message}`);
	        }
	        return invocationResult.all_return_values[0].returned;
	    }
	    onInternalMethodInvoked(key, callback) {
	        return this.registry.add(key, callback);
	    }
	    verifyMethodLive(name, systemId) {
	        return promisePlus(() => {
	            return new Promise((resolve) => {
	                const hasMethod = this.agm.methods().some((method) => {
	                    const nameMatch = method.name === name;
	                    const serverMatch = systemId ?
	                        method.getServers().some((server) => server.instance === systemId) :
	                        true;
	                    return nameMatch && serverMatch;
	                });
	                if (hasMethod) {
	                    resolve();
	                    return;
	                }
	                const unSub = this.agm.serverMethodAdded((data) => {
	                    const method = data.method;
	                    const server = data.server;
	                    const serverMatch = systemId ?
	                        server.instance === systemId :
	                        true;
	                    if (method.name === name && serverMatch) {
	                        unSub();
	                        resolve();
	                    }
	                });
	            });
	        }, 15000, "Timeout waiting for the Workspaces communication channels");
	    }
	    registerMethod(key) {
	        const method = INCOMING_METHODS[key];
	        return this.agm.register(method.name, (args, caller) => {
	            this.registry.execute(key, args, caller);
	        });
	    }
	}

	const privateData$4 = new WeakMap();
	class ParentBuilder {
	    constructor(definition, base) {
	        const children = base.wrapChildren(definition.children);
	        delete definition.children;
	        privateData$4.set(this, { base, children, definition });
	    }
	    get type() {
	        return privateData$4.get(this).definition.type;
	    }
	    addColumn(definition) {
	        const base = privateData$4.get(this).base;
	        return base.add("column", privateData$4.get(this).children, definition);
	    }
	    addRow(definition) {
	        const base = privateData$4.get(this).base;
	        return base.add("row", privateData$4.get(this).children, definition);
	    }
	    addGroup(definition) {
	        const base = privateData$4.get(this).base;
	        return base.add("group", privateData$4.get(this).children, definition);
	    }
	    addWindow(definition) {
	        const base = privateData$4.get(this).base;
	        base.addWindow(privateData$4.get(this).children, definition);
	        return this;
	    }
	    serialize() {
	        const definition = privateData$4.get(this).definition;
	        definition.children = privateData$4.get(this).base.serializeChildren(privateData$4.get(this).children);
	        return definition;
	    }
	}

	class BaseBuilder {
	    getBuilder;
	    constructor(getBuilder) {
	        this.getBuilder = getBuilder;
	    }
	    wrapChildren(children) {
	        return children.map((child) => {
	            if (child.type === "window") {
	                return child;
	            }
	            return this.getBuilder({ type: child.type, definition: child });
	        });
	    }
	    add(type, children, definition) {
	        const validatedDefinition = parentDefinitionDecoder.runWithException(definition);
	        const childBuilder = this.getBuilder({ type, definition: validatedDefinition });
	        children.push(childBuilder);
	        return childBuilder;
	    }
	    addWindow(children, definition) {
	        const validatedDefinition = swimlaneWindowDefinitionDecoder.runWithException(definition);
	        validatedDefinition.type = "window";
	        children.push(validatedDefinition);
	    }
	    serializeChildren(children) {
	        return children.map((child) => {
	            if (child instanceof ParentBuilder) {
	                return child.serialize();
	            }
	            else {
	                return child;
	            }
	        });
	    }
	}

	const privateData$3 = new WeakMap();
	class WorkspaceBuilder {
	    constructor(definition, base, controller) {
	        const children = base.wrapChildren(definition.children);
	        delete definition.children;
	        privateData$3.set(this, { base, children, definition, controller });
	    }
	    addColumn(definition) {
	        const children = privateData$3.get(this).children;
	        const areAllColumns = children.every((child) => child instanceof ParentBuilder && child.type === "column");
	        if (!areAllColumns) {
	            throw new Error("Cannot add a column to this workspace, because there are already children of another type");
	        }
	        const base = privateData$3.get(this).base;
	        return base.add("column", children, definition);
	    }
	    addRow(definition) {
	        const children = privateData$3.get(this).children;
	        const areAllRows = children.every((child) => child instanceof ParentBuilder && child.type === "row");
	        if (!areAllRows) {
	            throw new Error("Cannot add a row to this workspace, because there are already children of another type");
	        }
	        const base = privateData$3.get(this).base;
	        return base.add("row", children, definition);
	    }
	    addGroup(definition) {
	        const children = privateData$3.get(this).children;
	        if (children.length !== 0) {
	            throw new Error("Cannot add a group to this workspace, because there are already defined children.");
	        }
	        const base = privateData$3.get(this).base;
	        return base.add("group", children, definition);
	    }
	    addWindow(definition) {
	        const children = privateData$3.get(this).children;
	        if (children.length !== 0) {
	            throw new Error("Cannot add a window to this workspace, because there are already defined children.");
	        }
	        const base = privateData$3.get(this).base;
	        base.addWindow(children, definition);
	        return this;
	    }
	    getChildAt(index) {
	        nonNegativeNumberDecoder.runWithException(index);
	        const data = privateData$3.get(this).children;
	        return data[index];
	    }
	    async create(config) {
	        const saveConfig = workspaceBuilderCreateConfigDecoder.runWithException(config);
	        const definition = privateData$3.get(this).definition;
	        definition.children = privateData$3.get(this).base.serializeChildren(privateData$3.get(this).children);
	        const controller = privateData$3.get(this).controller;
	        return controller.createWorkspace(definition, saveConfig);
	    }
	}

	const privateData$2 = new WeakMap();
	const getBase$2 = (model) => {
	    return privateData$2.get(model).base;
	};
	class Row {
	    constructor(base) {
	        privateData$2.set(this, { base });
	    }
	    get type() {
	        return "row";
	    }
	    get id() {
	        return getBase$2(this).getId(this);
	    }
	    get frameId() {
	        return getBase$2(this).getFrameId(this);
	    }
	    get workspaceId() {
	        return getBase$2(this).getWorkspaceId(this);
	    }
	    get positionIndex() {
	        return getBase$2(this).getPositionIndex(this);
	    }
	    get children() {
	        return getBase$2(this).getAllChildren(this);
	    }
	    get parent() {
	        return getBase$2(this).getMyParent(this);
	    }
	    get frame() {
	        return getBase$2(this).getMyFrame(this);
	    }
	    get workspace() {
	        return getBase$2(this).getMyWorkspace(this);
	    }
	    get allowDrop() {
	        return getBase$2(this).getAllowDrop(this);
	    }
	    get allowSplitters() {
	        return getBase$2(this).getAllowSplitters(this);
	    }
	    get minWidth() {
	        return getBase$2(this).getMinWidth(this);
	    }
	    get minHeight() {
	        return getBase$2(this).getMinHeight(this);
	    }
	    get maxWidth() {
	        return getBase$2(this).getMaxWidth(this);
	    }
	    get maxHeight() {
	        return getBase$2(this).getMaxHeight(this);
	    }
	    get width() {
	        return getBase$2(this).getWidthInPx(this);
	    }
	    get height() {
	        return getBase$2(this).getHeightInPx(this);
	    }
	    get isPinned() {
	        return getBase$2(this).getIsPinned(this);
	    }
	    get isMaximized() {
	        return getBase$2(this).getIsMaximized(this);
	    }
	    get maximizationBoundary() {
	        return getBase$2(this).getMaximizationBoundary(this);
	    }
	    addWindow(definition) {
	        return getBase$2(this).addWindow(this, definition, "row");
	    }
	    async addGroup(definition) {
	        if (definition?.type && definition.type !== "group") {
	            throw new Error(`Expected a group definition, but received ${definition.type}`);
	        }
	        return getBase$2(this).addParent(this, "group", "row", definition);
	    }
	    async addColumn(definition) {
	        if (definition?.type && definition.type !== "column") {
	            throw new Error(`Expected a column definition, but received ${definition.type}`);
	        }
	        return getBase$2(this).addParent(this, "column", "row", definition);
	    }
	    async addRow() {
	        throw new Error("Adding rows as row children is not supported");
	    }
	    removeChild(predicate) {
	        return getBase$2(this).removeChild(this, predicate);
	    }
	    maximize() {
	        return getBase$2(this).maximize(this);
	    }
	    restore() {
	        return getBase$2(this).restore(this);
	    }
	    close() {
	        return getBase$2(this).close(this);
	    }
	    lock(config) {
	        let lockConfigResult = undefined;
	        if (typeof config === "function") {
	            const currentLockConfig = {
	                allowDrop: this.allowDrop,
	                allowSplitters: this.allowSplitters
	            };
	            lockConfigResult = config(currentLockConfig);
	        }
	        else {
	            lockConfigResult = config;
	        }
	        const verifiedConfig = lockConfigResult === undefined ? undefined : rowLockConfigDecoder.runWithException(lockConfigResult);
	        return getBase$2(this).lockContainer(this, verifiedConfig);
	    }
	    async setHeight(height) {
	        nonNegativeNumberDecoder.runWithException(height);
	        return getBase$2(this).setHeight(this, height);
	    }
	    async onLockConfigurationChanged(callback) {
	        checkThrowCallback(callback);
	        const wrappedCallback = async () => {
	            await this.workspace.refreshReference();
	            callback({
	                allowDrop: this.allowDrop,
	                allowSplitters: this.allowSplitters
	            });
	        };
	        const config = {
	            callback: wrappedCallback,
	            action: "lock-configuration-changed",
	            eventType: "container",
	            scope: "container"
	        };
	        const unsubscribe = await getBase$2(this).processLocalSubscription(this, config);
	        return unsubscribe;
	    }
	    async setMaximizationBoundary(config) {
	        const validatedConfig = setMaximizationBoundaryAPIConfigDecoder.runWithException(config);
	        return getBase$2(this).setMaximizationBoundary(this, validatedConfig);
	    }
	}

	const privateData$1 = new WeakMap();
	const getBase$1 = (model) => {
	    return privateData$1.get(model).base;
	};
	class Column {
	    constructor(base) {
	        privateData$1.set(this, { base });
	    }
	    get type() {
	        return "column";
	    }
	    get id() {
	        return getBase$1(this).getId(this);
	    }
	    get frameId() {
	        return getBase$1(this).getFrameId(this);
	    }
	    get workspaceId() {
	        return getBase$1(this).getWorkspaceId(this);
	    }
	    get positionIndex() {
	        return getBase$1(this).getPositionIndex(this);
	    }
	    get children() {
	        return getBase$1(this).getAllChildren(this);
	    }
	    get parent() {
	        return getBase$1(this).getMyParent(this);
	    }
	    get frame() {
	        return getBase$1(this).getMyFrame(this);
	    }
	    get workspace() {
	        return getBase$1(this).getMyWorkspace(this);
	    }
	    get allowDrop() {
	        return getBase$1(this).getAllowDrop(this);
	    }
	    get allowSplitters() {
	        return getBase$1(this).getAllowSplitters(this);
	    }
	    get minWidth() {
	        return getBase$1(this).getMinWidth(this);
	    }
	    get minHeight() {
	        return getBase$1(this).getMinHeight(this);
	    }
	    get maxWidth() {
	        return getBase$1(this).getMaxWidth(this);
	    }
	    get maxHeight() {
	        return getBase$1(this).getMaxHeight(this);
	    }
	    get width() {
	        return getBase$1(this).getWidthInPx(this);
	    }
	    get height() {
	        return getBase$1(this).getHeightInPx(this);
	    }
	    get isPinned() {
	        return getBase$1(this).getIsPinned(this);
	    }
	    get isMaximized() {
	        return getBase$1(this).getIsMaximized(this);
	    }
	    get maximizationBoundary() {
	        return getBase$1(this).getMaximizationBoundary(this);
	    }
	    addWindow(definition) {
	        return getBase$1(this).addWindow(this, definition, "column");
	    }
	    async addGroup(definition) {
	        if (definition?.type && definition.type !== "group") {
	            throw new Error(`Expected a group definition, but received ${definition.type}`);
	        }
	        return getBase$1(this).addParent(this, "group", "column", definition);
	    }
	    async addColumn() {
	        throw new Error("Adding columns as column children is not supported");
	    }
	    async addRow(definition) {
	        if (definition?.type && definition.type !== "row") {
	            throw new Error(`Expected a row definition, but received ${definition.type}`);
	        }
	        return getBase$1(this).addParent(this, "row", "column", definition);
	    }
	    removeChild(predicate) {
	        return getBase$1(this).removeChild(this, predicate);
	    }
	    maximize() {
	        return getBase$1(this).maximize(this);
	    }
	    restore() {
	        return getBase$1(this).restore(this);
	    }
	    close() {
	        return getBase$1(this).close(this);
	    }
	    lock(config) {
	        let lockConfigResult = undefined;
	        if (typeof config === "function") {
	            const currentLockConfig = {
	                allowDrop: this.allowDrop,
	                allowSplitters: this.allowSplitters
	            };
	            lockConfigResult = config(currentLockConfig);
	        }
	        else {
	            lockConfigResult = config;
	        }
	        const verifiedConfig = lockConfigResult === undefined ? undefined : columnLockConfigDecoder.runWithException(lockConfigResult);
	        return getBase$1(this).lockContainer(this, verifiedConfig);
	    }
	    async setWidth(width) {
	        nonNegativeNumberDecoder.runWithException(width);
	        return getBase$1(this).setWidth(this, width);
	    }
	    async onLockConfigurationChanged(callback) {
	        checkThrowCallback(callback);
	        const wrappedCallback = async () => {
	            await this.workspace.refreshReference();
	            callback({
	                allowDrop: this.allowDrop,
	                allowSplitters: this.allowSplitters
	            });
	        };
	        const config = {
	            callback: wrappedCallback,
	            action: "lock-configuration-changed",
	            eventType: "container",
	            scope: "container"
	        };
	        const unsubscribe = await getBase$1(this).processLocalSubscription(this, config);
	        return unsubscribe;
	    }
	    async setMaximizationBoundary(config) {
	        const validatedConfig = setMaximizationBoundaryAPIConfigDecoder.runWithException(config);
	        return getBase$1(this).setMaximizationBoundary(this, validatedConfig);
	    }
	}

	const privateData = new WeakMap();
	const getBase = (model) => {
	    return privateData.get(model).base;
	};
	class Group {
	    constructor(base) {
	        privateData.set(this, { base });
	    }
	    get type() {
	        return "group";
	    }
	    get id() {
	        return getBase(this).getId(this);
	    }
	    get frameId() {
	        return getBase(this).getFrameId(this);
	    }
	    get workspaceId() {
	        return getBase(this).getWorkspaceId(this);
	    }
	    get positionIndex() {
	        return getBase(this).getPositionIndex(this);
	    }
	    get children() {
	        return getBase(this).getAllChildren(this);
	    }
	    get parent() {
	        return getBase(this).getMyParent(this);
	    }
	    get frame() {
	        return getBase(this).getMyFrame(this);
	    }
	    get workspace() {
	        return getBase(this).getMyWorkspace(this);
	    }
	    get allowExtract() {
	        return getBase(this).getAllowExtract(this);
	    }
	    get allowReorder() {
	        return getBase(this).getAllowReorder(this);
	    }
	    get allowDropLeft() {
	        return getBase(this).getAllowDropLeft(this);
	    }
	    get allowDropRight() {
	        return getBase(this).getAllowDropRight(this);
	    }
	    get allowDropTop() {
	        return getBase(this).getAllowDropTop(this);
	    }
	    get allowDropBottom() {
	        return getBase(this).getAllowDropBottom(this);
	    }
	    get allowDropHeader() {
	        return getBase(this).getAllowDropHeader(this);
	    }
	    get allowDrop() {
	        return getBase(this).getAllowDrop(this);
	    }
	    get showMaximizeButton() {
	        return getBase(this).getShowMaximizeButton(this);
	    }
	    get showEjectButton() {
	        return getBase(this).getShowEjectButton(this);
	    }
	    get showAddWindowButton() {
	        return getBase(this).getShowAddWindowButton(this);
	    }
	    get minWidth() {
	        return getBase(this).getMinWidth(this);
	    }
	    get minHeight() {
	        return getBase(this).getMinHeight(this);
	    }
	    get maxWidth() {
	        return getBase(this).getMaxWidth(this);
	    }
	    get maxHeight() {
	        return getBase(this).getMaxHeight(this);
	    }
	    get width() {
	        return getBase(this).getWidthInPx(this);
	    }
	    get height() {
	        return getBase(this).getHeightInPx(this);
	    }
	    get isMaximized() {
	        return getBase(this).getIsMaximized(this);
	    }
	    addWindow(definition) {
	        return getBase(this).addWindow(this, definition, "group");
	    }
	    async addGroup() {
	        throw new Error("Adding groups as group child is not supported");
	    }
	    async addColumn() {
	        throw new Error("Adding columns as group child is not supported");
	    }
	    async addRow() {
	        throw new Error("Adding rows as group child is not supported");
	    }
	    removeChild(predicate) {
	        return getBase(this).removeChild(this, predicate);
	    }
	    maximize() {
	        return getBase(this).maximize(this);
	    }
	    restore() {
	        return getBase(this).restore(this);
	    }
	    close() {
	        return getBase(this).close(this);
	    }
	    lock(config) {
	        let lockConfigResult = undefined;
	        if (typeof config === "function") {
	            const currentLockConfig = {
	                allowDrop: this.allowDrop,
	                allowDropHeader: this.allowDropHeader,
	                allowDropLeft: this.allowDropLeft,
	                allowDropRight: this.allowDropRight,
	                allowDropTop: this.allowDropTop,
	                allowDropBottom: this.allowDropBottom,
	                allowExtract: this.allowExtract,
	                allowReorder: this.allowReorder,
	                showAddWindowButton: this.showAddWindowButton,
	                showEjectButton: this.showEjectButton,
	                showMaximizeButton: this.showMaximizeButton
	            };
	            lockConfigResult = config(currentLockConfig);
	        }
	        else {
	            lockConfigResult = config;
	        }
	        const verifiedConfig = lockConfigResult === undefined ? undefined : groupLockConfigDecoder.runWithException(lockConfigResult);
	        return getBase(this).lockContainer(this, verifiedConfig);
	    }
	    async setSize(config) {
	        const verifiedConfig = elementResizeConfigDecoder.runWithException(config);
	        if (!verifiedConfig.width && !verifiedConfig.height) {
	            throw new Error("Expected either width or height to be passed.");
	        }
	        return getBase(this).setSize(this, config.width, config.height);
	    }
	    async bundleToRow() {
	        await getBase(this).bundleTo(this, "row");
	        await this.workspace.refreshReference();
	    }
	    async bundleToColumn() {
	        await getBase(this).bundleTo(this, "column");
	        await this.workspace.refreshReference();
	    }
	    async onLockConfigurationChanged(callback) {
	        checkThrowCallback(callback);
	        const wrappedCallback = async () => {
	            await this.workspace.refreshReference();
	            callback({
	                allowDrop: this.allowDrop,
	                allowDropHeader: this.allowDropHeader,
	                allowDropLeft: this.allowDropLeft,
	                allowDropTop: this.allowDropTop,
	                allowDropRight: this.allowDropRight,
	                allowDropBottom: this.allowDropBottom,
	                allowExtract: this.allowExtract,
	                allowReorder: this.allowReorder,
	                showAddWindowButton: this.showAddWindowButton,
	                showEjectButton: this.showEjectButton,
	                showMaximizeButton: this.showMaximizeButton
	            });
	        };
	        const config = {
	            callback: wrappedCallback,
	            action: "lock-configuration-changed",
	            eventType: "container",
	            scope: "container"
	        };
	        const unsubscribe = await getBase(this).processLocalSubscription(this, config);
	        return unsubscribe;
	    }
	}

	const DEFAULT_WINDOW_DRAG_MODE = "keepInside";

	const data$3 = new WeakMap();
	const getData$3 = (model) => {
	    return data$3.get(model).manager.getWorkspaceData(model);
	};
	const getDataManager = (model) => {
	    return data$3.get(model).manager;
	};
	class Workspace {
	    constructor(dataManager) {
	        data$3.set(this, { manager: dataManager });
	    }
	    get id() {
	        return getData$3(this).id;
	    }
	    get frameId() {
	        return getData$3(this).config.frameId;
	    }
	    get positionIndex() {
	        return getData$3(this).config.positionIndex;
	    }
	    get title() {
	        return getData$3(this).config.title;
	    }
	    get layoutName() {
	        return getData$3(this).config.layoutName;
	    }
	    get isHibernated() {
	        return getData$3(this).config.isHibernated;
	    }
	    get isSelected() {
	        return getData$3(this).config.isSelected;
	    }
	    get children() {
	        return getData$3(this).children;
	    }
	    get frame() {
	        return getData$3(this).frame;
	    }
	    get allowSplitters() {
	        return getData$3(this).config.allowSplitters;
	    }
	    get allowSystemHibernation() {
	        return getData$3(this).config.allowSystemHibernation;
	    }
	    get allowDrop() {
	        return getData$3(this).config.allowDrop;
	    }
	    get allowDropLeft() {
	        return getData$3(this).config.allowDropLeft;
	    }
	    get allowDropTop() {
	        return getData$3(this).config.allowDropTop;
	    }
	    get allowDropRight() {
	        return getData$3(this).config.allowDropRight;
	    }
	    get allowDropBottom() {
	        return getData$3(this).config.allowDropBottom;
	    }
	    get allowExtract() {
	        return getData$3(this).config.allowExtract;
	    }
	    get allowWindowReorder() {
	        return getData$3(this).config.allowWindowReorder;
	    }
	    get showCloseButton() {
	        return getData$3(this).config.showCloseButton;
	    }
	    get showSaveButton() {
	        return getData$3(this).config.showSaveButton;
	    }
	    get allowWorkspaceTabReorder() {
	        return getData$3(this).config.allowWorkspaceTabReorder;
	    }
	    get allowWorkspaceTabExtract() {
	        return getData$3(this).config.allowWorkspaceTabExtract;
	    }
	    get minWidth() {
	        return getData$3(this).config.minWidth;
	    }
	    get minHeight() {
	        return getData$3(this).config.minHeight;
	    }
	    get maxWidth() {
	        return getData$3(this).config.maxWidth;
	    }
	    get maxHeight() {
	        return getData$3(this).config.maxHeight;
	    }
	    get width() {
	        return getData$3(this).config.widthInPx;
	    }
	    get height() {
	        return getData$3(this).config.heightInPx;
	    }
	    get showWindowCloseButtons() {
	        return getData$3(this).config.showWindowCloseButtons;
	    }
	    get showEjectButtons() {
	        return getData$3(this).config.showEjectButtons;
	    }
	    get showAddWindowButtons() {
	        return getData$3(this).config.showAddWindowButtons;
	    }
	    get isPinned() {
	        return getData$3(this).config.isPinned;
	    }
	    get windowDragMode() {
	        const desktopGlobal = isDesktop();
	        if (!desktopGlobal) {
	            return DEFAULT_WINDOW_DRAG_MODE;
	        }
	        return getData$3(this).config.windowDragMode;
	    }
	    get loadingStrategy() {
	        if (!isDesktop()) {
	            console.warn("The workspace.loadingStrategy property is not supported in IO Connect Browser");
	        }
	        return getData$3(this).config.loadingStrategy;
	    }
	    async setLoadingStrategy(strategy) {
	        if (!isDesktop()) {
	            throw new Error("Not supported in IO Connect Browser");
	        }
	        const controller = getData$3(this).controller;
	        await controller.setLoadingStrategy(this.id, strategy);
	        await this.refreshReference();
	    }
	    async removeChild(predicate) {
	        checkThrowCallback(predicate);
	        const child = this.children.find(predicate);
	        if (!child) {
	            return;
	        }
	        await child.close();
	        await this.refreshReference();
	    }
	    async remove(predicate) {
	        checkThrowCallback(predicate);
	        const controller = getData$3(this).controller;
	        const child = controller.iterateFindChild(this.children, predicate);
	        await child.close();
	        await this.refreshReference();
	    }
	    async focus() {
	        await getData$3(this).controller.focusItem(this.id);
	        await this.refreshReference();
	    }
	    async close() {
	        const controller = getData$3(this).controller;
	        const workspaces = await getData$3(this).frame.workspaces();
	        const platformFrameId = (await controller.getPlatformFrameId()).id;
	        const shouldCloseFrame = workspaces.length === 1 &&
	            workspaces.every((wsp) => wsp.id === this.id) &&
	            platformFrameId !== this.frame.id;
	        if (shouldCloseFrame) {
	            return this.frame.close();
	        }
	        await controller.closeItem(this.id);
	    }
	    snapshot() {
	        return getData$3(this).controller.getSnapshot(this.id, "workspace");
	    }
	    async saveLayout(name, config) {
	        nonEmptyStringDecoder.runWithException(name);
	        await getData$3(this).controller.saveLayout({ name, workspaceId: this.id, saveContext: config?.saveContext, metadata: config?.metadata, allowMultiple: config?.allowMultiple });
	    }
	    async setTitle(title) {
	        nonEmptyStringDecoder.runWithException(title);
	        const controller = getData$3(this).controller;
	        await controller.setItemTitle(this.id, title);
	        await this.refreshReference();
	    }
	    getContext() {
	        const controller = getData$3(this).controller;
	        return controller.getWorkspaceContext(this.id);
	    }
	    setContext(data) {
	        const controller = getData$3(this).controller;
	        return controller.setWorkspaceContext(this.id, data);
	    }
	    updateContext(data) {
	        const controller = getData$3(this).controller;
	        return controller.updateWorkspaceContext(this.id, data);
	    }
	    onContextUpdated(callback) {
	        const controller = getData$3(this).controller;
	        return controller.subscribeWorkspaceContextUpdated(this.id, callback);
	    }
	    async refreshReference() {
	        const newSnapshot = (await getData$3(this).controller.getSnapshot(this.id, "workspace"));
	        const currentChildrenFlat = getData$3(this).controller.flatChildren(getData$3(this).children);
	        const newChildren = getData$3(this).controller.refreshChildren({
	            existingChildren: currentChildrenFlat,
	            workspace: this,
	            parent: this,
	            children: newSnapshot.children
	        });
	        const currentFrame = this.frame;
	        let actualFrame;
	        if (currentFrame.id === newSnapshot.config.frameId) {
	            getDataManager(this).remapFrame(currentFrame, newSnapshot.frameSummary);
	            actualFrame = currentFrame;
	        }
	        else {
	            const frameCreateConfig = {
	                summary: newSnapshot.frameSummary
	            };
	            const newFrame = getData$3(this).ioc.getModel("frame", frameCreateConfig);
	            actualFrame = newFrame;
	        }
	        getDataManager(this).remapWorkspace(this, {
	            config: newSnapshot.config,
	            children: newChildren,
	            frame: actualFrame
	        });
	    }
	    async getIcon() {
	        const controller = getData$3(this).controller;
	        return controller.getWorkspaceIcon(this.id);
	    }
	    async setIcon(icon) {
	        const controller = getData$3(this).controller;
	        return controller.setWorkspaceIcon(this.id, icon);
	    }
	    getBox(predicate) {
	        checkThrowCallback(predicate);
	        const children = getData$3(this).children;
	        const controller = getData$3(this).controller;
	        return controller.iterateFindChild(children, (child) => child.type !== "window" && predicate(child));
	    }
	    getAllBoxes(predicate) {
	        checkThrowCallback(predicate, true);
	        const children = getData$3(this).children;
	        const controller = getData$3(this).controller;
	        const allParents = controller.iterateFilterChildren(children, (child) => child.type !== "window");
	        if (!predicate) {
	            return allParents;
	        }
	        return allParents.filter(predicate);
	    }
	    getRow(predicate) {
	        checkThrowCallback(predicate);
	        return this.getBox((parent) => parent.type === "row" && predicate(parent));
	    }
	    getAllRows(predicate) {
	        checkThrowCallback(predicate, true);
	        if (predicate) {
	            return this.getAllBoxes((parent) => parent.type === "row" && predicate(parent));
	        }
	        return this.getAllBoxes((parent) => parent.type === "row");
	    }
	    getColumn(predicate) {
	        checkThrowCallback(predicate);
	        return this.getBox((parent) => parent.type === "column" && predicate(parent));
	    }
	    getAllColumns(predicate) {
	        checkThrowCallback(predicate, true);
	        if (predicate) {
	            return this.getAllBoxes((parent) => parent.type === "column" && predicate(parent));
	        }
	        return this.getAllBoxes((parent) => parent.type === "column");
	    }
	    getGroup(predicate) {
	        checkThrowCallback(predicate);
	        return this.getBox((parent) => parent.type === "group" && predicate(parent));
	    }
	    getAllGroups(predicate) {
	        checkThrowCallback(predicate, true);
	        if (predicate) {
	            return this.getAllBoxes((parent) => parent.type === "group" && predicate(parent));
	        }
	        return this.getAllBoxes((parent) => parent.type === "group");
	    }
	    getWindow(predicate) {
	        checkThrowCallback(predicate);
	        const children = getData$3(this).children;
	        const controller = getData$3(this).controller;
	        return controller.iterateFindChild(children, (child) => child.type === "window" && predicate(child));
	    }
	    getAllWindows(predicate) {
	        checkThrowCallback(predicate, true);
	        const children = getData$3(this).children;
	        const controller = getData$3(this).controller;
	        const allWindows = controller.iterateFilterChildren(children, (child) => child.type === "window");
	        if (!predicate) {
	            return allWindows;
	        }
	        return allWindows.filter(predicate);
	    }
	    addRow(definition) {
	        return getData$3(this).base.addParent(this, "row", "workspace", definition);
	    }
	    addColumn(definition) {
	        return getData$3(this).base.addParent(this, "column", "workspace", definition);
	    }
	    addGroup(definition) {
	        return getData$3(this).base.addParent(this, "group", "workspace", definition);
	    }
	    addWindow(definition) {
	        return getData$3(this).base.addWindow(this, definition, "workspace");
	    }
	    async bundleToRow() {
	        await getData$3(this).controller.bundleWorkspaceTo("row", this.id);
	        await this.refreshReference();
	    }
	    async bundleToColumn() {
	        await getData$3(this).controller.bundleWorkspaceTo("column", this.id);
	        await this.refreshReference();
	    }
	    async hibernate() {
	        await getData$3(this).controller.hibernateWorkspace(this.id);
	        await this.refreshReference();
	    }
	    async resume() {
	        await getData$3(this).controller.resumeWorkspace(this.id);
	        await this.refreshReference();
	    }
	    async lock(config) {
	        let lockConfigResult = undefined;
	        if (typeof config === "function") {
	            const currentLockConfig = {
	                allowDrop: this.allowDrop,
	                allowDropLeft: this.allowDropLeft,
	                allowDropTop: this.allowDropTop,
	                allowDropRight: this.allowDropRight,
	                allowDropBottom: this.allowDropBottom,
	                allowSystemHibernation: this.allowSystemHibernation,
	                allowExtract: this.allowExtract,
	                allowWindowReorder: this.allowWindowReorder,
	                allowSplitters: this.allowSplitters,
	                showCloseButton: this.showCloseButton,
	                showSaveButton: this.showSaveButton,
	                allowWorkspaceTabReorder: this.allowWorkspaceTabReorder,
	                allowWorkspaceTabExtract: this.allowWorkspaceTabExtract,
	                showAddWindowButtons: this.showAddWindowButtons,
	                showEjectButtons: this.showEjectButtons,
	                showWindowCloseButtons: this.showWindowCloseButtons
	            };
	            lockConfigResult = config(currentLockConfig);
	        }
	        else {
	            lockConfigResult = config;
	        }
	        const verifiedConfig = lockConfigResult === undefined ? undefined : workspaceLockConfigDecoder.runWithException(lockConfigResult);
	        await getData$3(this).controller.lockWorkspace(this.id, verifiedConfig);
	        await this.refreshReference();
	    }
	    async pin(options) {
	        workspacePinOptionsDecoder.runWithException(options);
	        await getData$3(this).controller.pinWorkspace(this.id, options?.icon);
	        await this.refreshReference();
	    }
	    async unpin() {
	        await getData$3(this).controller.unpinWorkspace(this.id);
	        await this.refreshReference();
	    }
	    async showLoadingAnimation() {
	        if (!isDesktop()) {
	            throw new Error("Not supported in IO Connect Browser");
	        }
	        await getData$3(this).controller.showWorkspaceLoadingAnimation(this.id);
	    }
	    async hideLoadingAnimation() {
	        if (!isDesktop()) {
	            throw new Error("Not supported in IO Connect Browser");
	        }
	        await getData$3(this).controller.hideWorkspaceLoadingAnimation(this.id);
	    }
	    async setWindowDragMode(mode) {
	        const desktopGlobal = isDesktop();
	        if (!desktopGlobal) {
	            throw new Error("Not supported in IO Connect Browser");
	        }
	        windowDragModeDecoder.runWithException(mode);
	        await getData$3(this).controller.setWindowDragMode(this.id, mode);
	        await this.refreshReference();
	    }
	    async onClosed(callback) {
	        checkThrowCallback(callback);
	        const id = getData$3(this).id;
	        const wrappedCallback = async (payload) => {
	            callback({ frameId: payload.frameSummary.id, workspaceId: payload.workspaceSummary.id, frameBounds: payload.frameBounds });
	        };
	        const config = {
	            action: "closed",
	            eventType: "workspace",
	            scope: "workspace",
	            scopeId: id,
	            callback: wrappedCallback
	        };
	        const unsubscribe = await getData$3(this).controller.processLocalSubscription(config, id);
	        return unsubscribe;
	    }
	    async onHibernated(callback) {
	        checkThrowCallback(callback);
	        const id = getData$3(this).id;
	        const wrappedCallback = async () => {
	            await this.refreshReference();
	            callback();
	        };
	        const config = {
	            action: "hibernated",
	            eventType: "workspace",
	            scope: "workspace",
	            scopeId: id,
	            callback: wrappedCallback
	        };
	        const unsubscribe = await getData$3(this).controller.processLocalSubscription(config, id);
	        return unsubscribe;
	    }
	    async onResumed(callback) {
	        checkThrowCallback(callback);
	        const id = getData$3(this).id;
	        const wrappedCallback = async () => {
	            await this.refreshReference();
	            callback();
	        };
	        const config = {
	            action: "resumed",
	            eventType: "workspace",
	            scope: "workspace",
	            scopeId: id,
	            callback: wrappedCallback
	        };
	        const unsubscribe = await getData$3(this).controller.processLocalSubscription(config, id);
	        return unsubscribe;
	    }
	    async onWindowAdded(callback) {
	        checkThrowCallback(callback);
	        const id = getData$3(this).id;
	        const wrappedCallback = async (payload) => {
	            await this.refreshReference();
	            const windowParent = this.getBox((parent) => parent.id === payload.windowSummary.parentId);
	            const foundWindow = windowParent.children.find((child) => {
	                return child.type === "window" && child.elementId === payload.windowSummary.itemId;
	            });
	            callback(foundWindow);
	        };
	        const config = {
	            action: "added",
	            eventType: "window",
	            scope: "workspace",
	            scopeId: id,
	            callback: wrappedCallback
	        };
	        const unsubscribe = await getData$3(this).controller.processLocalSubscription(config, id);
	        return unsubscribe;
	    }
	    async onWindowRemoved(callback) {
	        checkThrowCallback(callback);
	        const id = getData$3(this).id;
	        const wrappedCallback = async (payload) => {
	            await this.refreshReference();
	            const { windowId, workspaceId, frameId } = payload.windowSummary.config;
	            callback({ windowId, workspaceId, frameId });
	        };
	        const config = {
	            action: "removed",
	            eventType: "window",
	            scope: "workspace",
	            scopeId: id,
	            callback: wrappedCallback
	        };
	        const unsubscribe = await getData$3(this).controller.processLocalSubscription(config, id);
	        return unsubscribe;
	    }
	    async onWindowLoaded(callback) {
	        checkThrowCallback(callback);
	        const id = getData$3(this).id;
	        const wrappedCallback = async (payload) => {
	            await this.refreshReference();
	            const foundWindow = this.getWindow((win) => {
	                return win.id && win.id === payload.windowSummary.config.windowId;
	            });
	            callback(foundWindow);
	        };
	        const config = {
	            action: "loaded",
	            eventType: "window",
	            scope: "workspace",
	            scopeId: id,
	            callback: wrappedCallback
	        };
	        const unsubscribe = await getData$3(this).controller.processLocalSubscription(config, id);
	        return unsubscribe;
	    }
	    async onWindowMaximized(callback) {
	        checkThrowCallback(callback);
	        const id = getData$3(this).id;
	        const wrappedCallback = async (payload) => {
	            await this.refreshReference();
	            const windowParent = this.getBox((parent) => parent.id === payload.windowSummary.parentId);
	            const foundWindow = windowParent.children.find((child) => {
	                return child.type === "window" && child.elementId === payload.windowSummary.itemId;
	            });
	            callback(foundWindow);
	        };
	        const config = {
	            action: "maximized",
	            eventType: "window",
	            scope: "workspace",
	            scopeId: id,
	            callback: wrappedCallback
	        };
	        const unsubscribe = await getData$3(this).controller.processLocalSubscription(config, id);
	        return unsubscribe;
	    }
	    async onWindowRestored(callback) {
	        checkThrowCallback(callback);
	        const id = getData$3(this).id;
	        const wrappedCallback = async (payload) => {
	            await this.refreshReference();
	            const windowParent = this.getBox((parent) => parent.id === payload.windowSummary.parentId);
	            const foundWindow = windowParent.children.find((child) => {
	                return child.type === "window" && child.elementId === payload.windowSummary.itemId;
	            });
	            callback(foundWindow);
	        };
	        const config = {
	            action: "restored",
	            eventType: "window",
	            scope: "workspace",
	            scopeId: id,
	            callback: wrappedCallback
	        };
	        const unsubscribe = await getData$3(this).controller.processLocalSubscription(config, id);
	        return unsubscribe;
	    }
	    async onWindowSelected(callback) {
	        checkThrowCallback(callback);
	        const id = getData$3(this).id;
	        const wrappedCallback = async (payload) => {
	            await this.refreshReference();
	            const windowParent = this.getBox((parent) => parent.id === payload.windowSummary.parentId);
	            const foundWindow = windowParent.children.find((child) => {
	                return child.type === "window" && child.elementId === payload.windowSummary.itemId;
	            });
	            callback(foundWindow);
	        };
	        const config = {
	            action: "selected",
	            eventType: "window",
	            scope: "workspace",
	            scopeId: id,
	            callback: wrappedCallback
	        };
	        const unsubscribe = await getData$3(this).controller.processLocalSubscription(config, id);
	        return unsubscribe;
	    }
	    async onLockConfigurationChanged(callback) {
	        checkThrowCallback(callback);
	        const id = getData$3(this).id;
	        const wrappedCallback = async () => {
	            await this.refreshReference();
	            callback({
	                allowDrop: this.allowDrop,
	                allowDropLeft: this.allowDropLeft,
	                allowDropTop: this.allowDropTop,
	                allowDropRight: this.allowDropRight,
	                allowDropBottom: this.allowDropBottom,
	                allowSystemHibernation: this.allowSystemHibernation,
	                allowExtract: this.allowExtract,
	                allowSplitters: this.allowSplitters,
	                allowWindowReorder: this.allowWindowReorder,
	                allowWorkspaceTabExtract: this.allowWorkspaceTabExtract,
	                allowWorkspaceTabReorder: this.allowWorkspaceTabReorder,
	                showAddWindowButtons: this.showAddWindowButtons,
	                showCloseButton: this.showCloseButton,
	                showEjectButtons: this.showEjectButtons,
	                showSaveButton: this.showSaveButton,
	                showWindowCloseButtons: this.showWindowCloseButtons
	            });
	        };
	        const config = {
	            action: "lock-configuration-changed",
	            eventType: "workspace",
	            scope: "workspace",
	            scopeId: id,
	            callback: wrappedCallback
	        };
	        const unsubscribe = await getData$3(this).controller.processLocalSubscription(config, id);
	        return unsubscribe;
	    }
	}

	const data$2 = new WeakMap();
	const getData$2 = (model) => {
	    return data$2.get(model).manager.getWindowData(model);
	};
	class Window {
	    constructor(dataManager) {
	        data$2.set(this, { manager: dataManager });
	    }
	    get id() {
	        return getData$2(this).config.windowId;
	    }
	    get elementId() {
	        return getData$2(this).id;
	    }
	    get type() {
	        return "window";
	    }
	    get frameId() {
	        return getData$2(this).frame.id;
	    }
	    get workspaceId() {
	        return getData$2(this).workspace.id;
	    }
	    get positionIndex() {
	        return getData$2(this).config.positionIndex;
	    }
	    get isMaximized() {
	        return getData$2(this).config.isMaximized;
	    }
	    get isLoaded() {
	        return getData$2(this).controller.checkIsWindowLoaded(this.id);
	    }
	    get isSelected() {
	        return getData$2(this).config.isSelected;
	    }
	    get focused() {
	        return this.getGdWindow().isFocused;
	    }
	    get title() {
	        return getData$2(this).config.title;
	    }
	    get allowExtract() {
	        return getData$2(this).config.allowExtract;
	    }
	    get allowReorder() {
	        return getData$2(this).config.allowReorder;
	    }
	    get showCloseButton() {
	        return getData$2(this).config.showCloseButton;
	    }
	    get width() {
	        return getData$2(this).config.widthInPx;
	    }
	    get height() {
	        return getData$2(this).config.heightInPx;
	    }
	    get minWidth() {
	        return getData$2(this).config.minWidth;
	    }
	    get minHeight() {
	        return getData$2(this).config.minHeight;
	    }
	    get maxWidth() {
	        return getData$2(this).config.maxWidth;
	    }
	    get maxHeight() {
	        return getData$2(this).config.maxHeight;
	    }
	    get workspace() {
	        return getData$2(this).workspace;
	    }
	    get frame() {
	        return getData$2(this).frame;
	    }
	    get parent() {
	        return getData$2(this).parent;
	    }
	    get appName() {
	        return getData$2(this).config.appName;
	    }
	    async forceLoad() {
	        if (this.isLoaded) {
	            return;
	        }
	        const controller = getData$2(this).controller;
	        const itemId = getData$2(this).id;
	        const windowId = await controller.forceLoadWindow(itemId);
	        getData$2(this).config.windowId = windowId;
	        await this.workspace.refreshReference();
	    }
	    async focus() {
	        const id = getData$2(this).id;
	        const controller = getData$2(this).controller;
	        await controller.focusItem(id);
	        await this.workspace.refreshReference();
	    }
	    async close() {
	        const id = getData$2(this).id;
	        const controller = getData$2(this).controller;
	        await controller.closeItem(id);
	        await getData$2(this)
	            .parent
	            .removeChild((child) => child.id === id);
	        await this.workspace.refreshReference();
	    }
	    async setTitle(title) {
	        nonEmptyStringDecoder.runWithException(title);
	        const itemId = getData$2(this).id;
	        const controller = getData$2(this).controller;
	        await controller.setItemTitle(itemId, title);
	        await this.workspace.refreshReference();
	    }
	    async maximize() {
	        const id = getData$2(this).id;
	        const controller = getData$2(this).controller;
	        await controller.maximizeItem(id);
	        await this.workspace.refreshReference();
	    }
	    async restore() {
	        const id = getData$2(this).id;
	        const controller = getData$2(this).controller;
	        await controller.restoreItem(id);
	        await this.workspace.refreshReference();
	    }
	    async eject() {
	        if (!this.isLoaded) {
	            throw new Error("Cannot eject this window, because it is not loaded yet");
	        }
	        const itemId = getData$2(this).id;
	        const newWindowId = await getData$2(this).controller.ejectWindow(itemId);
	        getData$2(this).config.windowId = newWindowId;
	        await this.workspace.refreshReference();
	        return this.getGdWindow();
	    }
	    getGdWindow() {
	        if (!this.isLoaded) {
	            throw new Error("Cannot fetch this GD window, because the window is not yet loaded");
	        }
	        const myId = getData$2(this).config.windowId;
	        const controller = getData$2(this).controller;
	        return controller.getGDWindow(myId);
	    }
	    async moveTo(parent) {
	        if (!(parent instanceof Row || parent instanceof Column || parent instanceof Group)) {
	            throw new Error("Cannot add to the provided parent, because the provided parent is not an instance of Row, Column or Group");
	        }
	        const myId = getData$2(this).id;
	        const controller = getData$2(this).controller;
	        const foundParent = await controller.getParent((p) => p.id === parent.id);
	        if (!foundParent) {
	            throw new Error("Cannot move the window to the selected parent, because this parent does not exist.");
	        }
	        await controller.moveWindowTo(myId, parent.id);
	        await this.workspace.refreshReference();
	    }
	    async lock(config) {
	        let lockConfigResult = undefined;
	        if (typeof config === "function") {
	            const currentLockConfig = {
	                allowExtract: this.allowExtract,
	                allowReorder: this.allowReorder,
	                showCloseButton: this.showCloseButton
	            };
	            lockConfigResult = config(currentLockConfig);
	        }
	        else {
	            lockConfigResult = config;
	        }
	        const verifiedConfig = lockConfigResult === undefined ? undefined : windowLockConfigDecoder.runWithException(lockConfigResult);
	        const windowPlacementId = getData$2(this).id;
	        await getData$2(this).controller.lockWindow(windowPlacementId, verifiedConfig);
	        await this.workspace.refreshReference();
	    }
	    async setSize(config) {
	        const verifiedConfig = elementResizeConfigDecoder.runWithException(config);
	        if (!verifiedConfig.width && !verifiedConfig.height) {
	            throw new Error("Expected either width or height to be passed.");
	        }
	        const myId = getData$2(this).id;
	        const controller = getData$2(this).controller;
	        await controller.resizeItem(myId, {
	            height: verifiedConfig.height,
	            width: verifiedConfig.width,
	            relative: false
	        });
	        await this.workspace.refreshReference();
	    }
	    async onRemoved(callback) {
	        checkThrowCallback(callback);
	        const id = getData$2(this).id;
	        const wrappedCallback = async () => {
	            await this.workspace.refreshReference();
	            callback();
	        };
	        const config = {
	            callback: wrappedCallback,
	            action: "removed",
	            eventType: "window",
	            scope: "window"
	        };
	        const unsubscribe = await getData$2(this).controller.processLocalSubscription(config, id);
	        return unsubscribe;
	    }
	    async onLockConfigurationChanged(callback) {
	        checkThrowCallback(callback);
	        const id = getData$2(this).id;
	        const wrappedCallback = async () => {
	            await this.workspace.refreshReference();
	            callback({
	                allowExtract: this.allowExtract,
	                allowReorder: this.allowReorder,
	                showCloseButton: this.showCloseButton
	            });
	        };
	        const config = {
	            callback: wrappedCallback,
	            action: "lock-configuration-changed",
	            eventType: "window",
	            scope: "window"
	        };
	        const unsubscribe = await getData$2(this).controller.processLocalSubscription(config, id);
	        return unsubscribe;
	    }
	}

	const data$1 = new WeakMap();
	const getData$1 = (model) => {
	    return data$1.get(model).manager.getFrameData(model);
	};
	class Frame {
	    constructor(dataManager) {
	        data$1.set(this, { manager: dataManager });
	    }
	    async registerShortcut(shortcut, callback) {
	        nonEmptyStringDecoder.runWithException(shortcut);
	        checkThrowCallback(callback);
	        const myId = getData$1(this).summary.id;
	        const unsubscribe = await getData$1(this).controller.registerShortcut(shortcut, myId, callback);
	        return unsubscribe;
	    }
	    get id() {
	        return getData$1(this).summary.id;
	    }
	    get isInitialized() {
	        return getData$1(this).summary.isInitialized;
	    }
	    getBounds() {
	        const myId = getData$1(this).summary.id;
	        return getData$1(this).controller.getFrameBounds(myId);
	    }
	    async resize(config) {
	        const validatedConfig = resizeConfigDecoder.runWithException(config);
	        const myId = getData$1(this).summary.id;
	        return getData$1(this).controller.resizeItem(myId, validatedConfig);
	    }
	    async move(config) {
	        const validatedConfig = moveConfigDecoder.runWithException(config);
	        const myId = getData$1(this).summary.id;
	        return getData$1(this).controller.moveFrame(myId, validatedConfig);
	    }
	    focus() {
	        const myId = getData$1(this).summary.id;
	        return getData$1(this).controller.focusItem(myId);
	    }
	    async state() {
	        if (!isDesktop()) {
	            throw new Error("State operations are not supported in IO Connect Browser");
	        }
	        const myId = getData$1(this).summary.id;
	        return getData$1(this).controller.getFrameState(myId);
	    }
	    async minimize() {
	        if (!isDesktop()) {
	            throw new Error("State operations are not supported in IO Connect Browser");
	        }
	        const myId = getData$1(this).summary.id;
	        return getData$1(this).controller.changeFrameState(myId, "minimized");
	    }
	    async maximize() {
	        if (!isDesktop()) {
	            throw new Error("State operations are not supported in IO Connect Browser");
	        }
	        const myId = getData$1(this).summary.id;
	        return getData$1(this).controller.changeFrameState(myId, "maximized");
	    }
	    async restore() {
	        if (!isDesktop()) {
	            throw new Error("State operations are not supported in IO Connect Browser");
	        }
	        const myId = getData$1(this).summary.id;
	        return getData$1(this).controller.changeFrameState(myId, "normal");
	    }
	    close() {
	        const myId = getData$1(this).summary.id;
	        return getData$1(this).controller.closeItem(myId);
	    }
	    snapshot() {
	        const myId = getData$1(this).summary.id;
	        return getData$1(this).controller.getSnapshot(myId, "frame");
	    }
	    async workspaces() {
	        const controller = getData$1(this).controller;
	        return controller.getWorkspacesByFrameId(this.id);
	    }
	    async getConstraints() {
	        const controller = getData$1(this).controller;
	        const myId = getData$1(this).summary.id;
	        return controller.getFrameConstraints(myId);
	    }
	    async restoreWorkspace(name, options) {
	        nonEmptyStringDecoder.runWithException(name);
	        const validatedOptions = restoreWorkspaceConfigDecoder.runWithException(options);
	        return getData$1(this).controller.restoreWorkspace(name, validatedOptions);
	    }
	    createWorkspace(definition, config) {
	        const validatedDefinition = workspaceDefinitionDecoder.runWithException(definition);
	        const validatedConfig = workspaceBuilderCreateConfigDecoder.runWithException(config);
	        return getData$1(this).controller.createWorkspace(validatedDefinition, validatedConfig);
	    }
	    async init(config) {
	        frameInitConfigDecoder.runWithException(config);
	        if (getData$1(this).summary.isInitialized) {
	            throw new Error("The frame has already been initialized");
	        }
	        return getData$1(this).controller.initFrame(this.id, config);
	    }
	    async onClosed(callback) {
	        checkThrowCallback(callback);
	        const myId = getData$1(this).summary.id;
	        const wrappedCallback = (payload) => {
	            callback({ frameId: payload.frameSummary.id, frameBounds: payload.frameBounds });
	        };
	        const config = {
	            callback: wrappedCallback,
	            action: "closed",
	            eventType: "frame",
	            scope: "frame"
	        };
	        const unsubscribe = await getData$1(this).controller.processLocalSubscription(config, myId);
	        return unsubscribe;
	    }
	    async onMaximized(callback) {
	        checkThrowCallback(callback);
	        const myId = getData$1(this).summary.id;
	        const wrappedCallback = () => {
	            callback();
	        };
	        const config = {
	            callback: wrappedCallback,
	            action: "maximized",
	            eventType: "frame",
	            scope: "frame"
	        };
	        const unsubscribe = await getData$1(this).controller.processLocalSubscription(config, myId);
	        return unsubscribe;
	    }
	    async onMinimized(callback) {
	        checkThrowCallback(callback);
	        const myId = getData$1(this).summary.id;
	        const wrappedCallback = () => {
	            callback();
	        };
	        const config = {
	            callback: wrappedCallback,
	            action: "minimized",
	            eventType: "frame",
	            scope: "frame"
	        };
	        const unsubscribe = await getData$1(this).controller.processLocalSubscription(config, myId);
	        return unsubscribe;
	    }
	    async onNormal(callback) {
	        checkThrowCallback(callback);
	        const myId = getData$1(this).summary.id;
	        const wrappedCallback = () => {
	            callback();
	        };
	        const config = {
	            callback: wrappedCallback,
	            action: "normal",
	            eventType: "frame",
	            scope: "frame"
	        };
	        const unsubscribe = await getData$1(this).controller.processLocalSubscription(config, myId);
	        return unsubscribe;
	    }
	    async onWorkspaceOpened(callback) {
	        checkThrowCallback(callback);
	        const myId = getData$1(this).summary.id;
	        const wrappedCallback = async (payload) => {
	            const workspace = await getData$1(this).controller.transformStreamPayloadToWorkspace(payload);
	            callback(workspace);
	        };
	        const config = {
	            callback: wrappedCallback,
	            action: "opened",
	            eventType: "workspace",
	            scope: "frame"
	        };
	        const unsubscribe = await getData$1(this).controller.processLocalSubscription(config, myId);
	        return unsubscribe;
	    }
	    async onWorkspaceSelected(callback) {
	        checkThrowCallback(callback);
	        const myId = getData$1(this).summary.id;
	        const wrappedCallback = async (payload) => {
	            const workspace = await getData$1(this).controller.getWorkspaceById(payload.workspaceSummary.id);
	            callback(workspace);
	        };
	        const config = {
	            callback: wrappedCallback,
	            action: "selected",
	            eventType: "workspace",
	            scope: "frame"
	        };
	        const unsubscribe = await getData$1(this).controller.processLocalSubscription(config, myId);
	        return unsubscribe;
	    }
	    async onWorkspaceClosed(callback) {
	        checkThrowCallback(callback);
	        const myId = getData$1(this).summary.id;
	        const wrappedCallback = (payload) => {
	            callback({ frameId: payload.frameSummary.id, workspaceId: payload.workspaceSummary.id, frameBounds: payload.frameBounds });
	        };
	        const config = {
	            callback: wrappedCallback,
	            action: "closed",
	            eventType: "workspace",
	            scope: "frame"
	        };
	        const unsubscribe = await getData$1(this).controller.processLocalSubscription(config, myId);
	        return unsubscribe;
	    }
	    async onWindowAdded(callback) {
	        checkThrowCallback(callback);
	        const myId = getData$1(this).summary.id;
	        const wrappedCallback = async (payload) => {
	            const foundParent = await getData$1(this).controller.getParent((parent) => parent.id === payload.windowSummary.parentId);
	            const foundWindow = foundParent.children.find((child) => child.type === "window" && child.positionIndex === payload.windowSummary.config.positionIndex);
	            callback(foundWindow);
	        };
	        const config = {
	            callback: wrappedCallback,
	            action: "added",
	            eventType: "window",
	            scope: "frame"
	        };
	        const unsubscribe = await getData$1(this).controller.processLocalSubscription(config, myId);
	        return unsubscribe;
	    }
	    async onWindowRemoved(callback) {
	        checkThrowCallback(callback);
	        const myId = getData$1(this).summary.id;
	        const wrappedCallback = (payload) => {
	            const { windowId, workspaceId, frameId } = payload.windowSummary.config;
	            callback({ windowId, workspaceId, frameId });
	        };
	        const config = {
	            callback: wrappedCallback,
	            action: "removed",
	            eventType: "window",
	            scope: "frame"
	        };
	        const unsubscribe = await getData$1(this).controller.processLocalSubscription(config, myId);
	        return unsubscribe;
	    }
	    async onWindowLoaded(callback) {
	        checkThrowCallback(callback);
	        const myId = getData$1(this).summary.id;
	        const wrappedCallback = async (payload) => {
	            const foundParent = await getData$1(this).controller.getParent((parent) => {
	                return parent.id === payload.windowSummary.parentId;
	            });
	            const foundWindow = foundParent.children.find((child) => child.type === "window" && child.positionIndex === payload.windowSummary.config.positionIndex);
	            callback(foundWindow);
	        };
	        const config = {
	            callback: wrappedCallback,
	            action: "loaded",
	            eventType: "window",
	            scope: "frame"
	        };
	        const unsubscribe = await getData$1(this).controller.processLocalSubscription(config, myId);
	        return unsubscribe;
	    }
	    async onInitializationRequested(callback) {
	        checkThrowCallback(callback);
	        if (!this.isInitialized) {
	            callback(getData$1(this).summary.initializationContext);
	        }
	        return () => { };
	    }
	    async onFocusChanged(callback) {
	        checkThrowCallback(callback);
	        const myData = getData$1(this);
	        const { id } = myData.summary;
	        const wrappedCallback = (args) => {
	            callback({ isFocused: args.frameSummary.isFocused });
	        };
	        const config = {
	            callback: wrappedCallback,
	            action: "focus",
	            eventType: "frame",
	            scope: "frame"
	        };
	        const unsubscribe = await myData.controller.processLocalSubscription(config, id);
	        return unsubscribe;
	    }
	}

	class PrivateDataManager {
	    parentsData = new WeakMap();
	    workspacesData = new WeakMap();
	    windowsData = new WeakMap();
	    framesData = new WeakMap();
	    deleteData(model) {
	        if (model instanceof Window) {
	            this.windowsData.delete(model);
	        }
	        if (model instanceof Workspace) {
	            this.workspacesData.delete(model);
	        }
	        if (model instanceof Row || model instanceof Column || model instanceof Group) {
	            this.parentsData.delete(model);
	        }
	        if (model instanceof Frame) {
	            this.framesData.delete(model);
	        }
	    }
	    setWindowData(model, data) {
	        this.windowsData.set(model, data);
	    }
	    setWorkspaceData(model, data) {
	        this.workspacesData.set(model, data);
	    }
	    setParentData(model, data) {
	        this.parentsData.set(model, data);
	    }
	    setFrameData(model, data) {
	        this.framesData.set(model, data);
	    }
	    getWindowData(model) {
	        return this.windowsData.get(model);
	    }
	    getWorkspaceData(model) {
	        return this.workspacesData.get(model);
	    }
	    getParentData(model) {
	        return this.parentsData.get(model);
	    }
	    getFrameData(model) {
	        return this.framesData.get(model);
	    }
	    remapChild(model, newData) {
	        if (model instanceof Window) {
	            const data = this.windowsData.get(model);
	            data.parent = newData.parent || data.parent;
	            data.config = newData.config || data.config;
	        }
	        if (model instanceof Row || model instanceof Column || model instanceof Group) {
	            const data = this.parentsData.get(model);
	            data.parent = newData.parent || data.parent;
	            data.config = newData.config || data.config;
	            data.children = newData.children || data.children;
	        }
	    }
	    remapFrame(model, newData) {
	        const data = this.framesData.get(model);
	        data.summary = newData;
	    }
	    remapWorkspace(model, newData) {
	        const data = this.workspacesData.get(model);
	        data.frame = newData.frame || data.frame;
	        data.config = newData.config || data.config;
	        data.children = newData.children || data.children;
	    }
	}

	const data = new WeakMap();
	const getData = (base, model) => {
	    const manager = data.get(base).manager;
	    if (model instanceof Workspace) {
	        return manager.getWorkspaceData(model);
	    }
	    return data.get(base).manager.getParentData(model);
	};
	class Base {
	    frameId;
	    workspaceId;
	    positionIndex;
	    constructor(dataManager) {
	        data.set(this, { manager: dataManager });
	    }
	    getId(model) {
	        return getData(this, model).id;
	    }
	    getPositionIndex(model) {
	        return getData(this, model).config.positionIndex;
	    }
	    getWorkspaceId(model) {
	        const privateData = getData(this, model);
	        return privateData.config.workspaceId || privateData.workspace.id;
	    }
	    getFrameId(model) {
	        return getData(this, model).frame.id;
	    }
	    getAllChildren(model, predicate) {
	        checkThrowCallback(predicate, true);
	        const children = getData(this, model).children;
	        if (typeof predicate === "undefined") {
	            return children;
	        }
	        return children.filter(predicate);
	    }
	    getMyParent(model) {
	        if (model instanceof Workspace) {
	            return model;
	        }
	        return getData(this, model).parent;
	    }
	    getMyFrame(model) {
	        return getData(this, model).frame;
	    }
	    getMyWorkspace(model) {
	        if (model instanceof Workspace) {
	            return model;
	        }
	        return getData(this, model).workspace;
	    }
	    async addWindow(model, definition, parentType) {
	        if (!definition.appName && !definition.windowId) {
	            throw new Error("The window definition should contain either an appName or a windowId");
	        }
	        const validatedDefinition = swimlaneWindowDefinitionDecoder.runWithException(definition);
	        const controller = getData(this, model).controller;
	        const operationResult = await controller.add("window", getData(this, model).id, parentType, validatedDefinition);
	        if (model instanceof Workspace) {
	            await model.refreshReference();
	            return model.getWindow(w => w.elementId === operationResult.itemId);
	        }
	        const myWorkspace = this.getMyWorkspace(model);
	        await myWorkspace.refreshReference();
	        return myWorkspace.getWindow(w => w.elementId === operationResult.itemId);
	    }
	    async addParent(model, typeToAdd, parentType, definition) {
	        const parentDefinition = this.transformDefinition(typeToAdd, definition);
	        const controller = getData(this, model).controller;
	        const newParentId = (await controller.add("container", getData(this, model).id, parentType, parentDefinition)).itemId;
	        if (model instanceof Workspace) {
	            await model.refreshReference();
	            return model.getBox((parent) => parent.id === newParentId);
	        }
	        const myWorkspace = this.getMyWorkspace(model);
	        await myWorkspace.refreshReference();
	        return myWorkspace.getBox((parent) => parent.id === newParentId);
	    }
	    async removeChild(model, predicate) {
	        checkThrowCallback(predicate);
	        const child = this.getAllChildren(model).find(predicate);
	        if (!child) {
	            return;
	        }
	        await child.close();
	        if (model instanceof Workspace) {
	            await model.refreshReference();
	            return;
	        }
	        await this.getMyWorkspace(model).refreshReference();
	    }
	    async maximize(model) {
	        const { controller, id } = getData(this, model);
	        await controller.maximizeItem(id);
	        await this.getMyWorkspace(model.parent).refreshReference();
	    }
	    async restore(model) {
	        const { controller, id } = getData(this, model);
	        await controller.restoreItem(id);
	        await this.getMyWorkspace(model.parent).refreshReference();
	    }
	    async close(model) {
	        const modelData = getData(this, model);
	        const controller = getData(this, model).controller;
	        await controller.closeItem(modelData.id);
	        await this.getMyWorkspace(modelData.parent).refreshReference();
	    }
	    async lockContainer(model, config) {
	        const modelData = getData(this, model);
	        const controller = getData(this, model).controller;
	        await controller.lockContainer(modelData.id, model.type, config);
	        await this.getMyWorkspace(modelData.parent).refreshReference();
	    }
	    getAllowDrop(model) {
	        return getData(this, model).config.allowDrop;
	    }
	    getAllowDropLeft(model) {
	        const privateData = getData(this, model);
	        if (privateData.type !== "group") {
	            throw new Error(`Property allowDropLeft is available only for groups and not on ${model.type} ${model.id}`);
	        }
	        return privateData.config.allowDropLeft;
	    }
	    getAllowDropRight(model) {
	        const privateData = getData(this, model);
	        if (privateData.type !== "group") {
	            throw new Error(`Property allowDropRight is available only for groups and not on ${model.type} ${model.id}`);
	        }
	        return privateData.config.allowDropRight;
	    }
	    getAllowDropTop(model) {
	        const privateData = getData(this, model);
	        if (privateData.type !== "group") {
	            throw new Error(`Property allowDropTop is available only for groups and not on ${model.type} ${model.id}`);
	        }
	        return privateData.config.allowDropTop;
	    }
	    getAllowDropBottom(model) {
	        const privateData = getData(this, model);
	        if (privateData.type !== "group") {
	            throw new Error(`Property allowDropBottom is available only for groups and not on ${model.type} ${model.id}`);
	        }
	        return privateData.config.allowDropBottom;
	    }
	    getAllowDropHeader(model) {
	        const privateData = getData(this, model);
	        if (privateData.type !== "group") {
	            throw new Error(`Property allowDropHeader is available only for groups and not on ${model.type} ${model.id}`);
	        }
	        return privateData.config.allowDropHeader;
	    }
	    getAllowSplitters(model) {
	        const privateData = getData(this, model);
	        if (privateData.type === "group") {
	            throw new Error(`Cannot get allow splitters from private data ${privateData.type}`);
	        }
	        return privateData.config.allowSplitters;
	    }
	    getAllowExtract(model) {
	        const privateData = getData(this, model);
	        if (privateData.type !== "group") {
	            throw new Error(`Cannot get allow extract from private data ${privateData.type} with config ${privateData.type !== "workspace" ? privateData.config.type : ""}`);
	        }
	        return privateData.config.allowExtract;
	    }
	    getAllowReorder(model) {
	        const privateData = getData(this, model);
	        if (privateData.type !== "group") {
	            throw new Error(`Cannot get allow extract from private data ${privateData.type} with config ${privateData.type !== "workspace" ? privateData.config.type : ""}`);
	        }
	        return privateData.config.allowReorder;
	    }
	    getShowMaximizeButton(model) {
	        const privateData = getData(this, model);
	        if (privateData.type !== "group") {
	            throw new Error(`Cannot get show maximize button from private data${privateData.type} with config ${privateData.type !== "workspace" ? privateData.config.type : ""}`);
	        }
	        return privateData.config.showMaximizeButton;
	    }
	    getShowEjectButton(model) {
	        const privateData = getData(this, model);
	        if (privateData.type !== "group") {
	            throw new Error(`Cannot get show eject button from private data${privateData.type} with config ${privateData.type !== "workspace" ? privateData.config.type : ""}`);
	        }
	        return privateData.config.showEjectButton;
	    }
	    getShowAddWindowButton(model) {
	        const privateData = getData(this, model);
	        if (privateData.type !== "group") {
	            throw new Error(`Cannot get add window button from private data${privateData.type} with config ${privateData.type !== "workspace" ? privateData.config.type : ""}`);
	        }
	        return privateData.config.showAddWindowButton;
	    }
	    getMinWidth(model) {
	        const privateData = getData(this, model);
	        return privateData.config.minWidth;
	    }
	    getMaxWidth(model) {
	        const privateData = getData(this, model);
	        return privateData.config.maxWidth;
	    }
	    getMinHeight(model) {
	        const privateData = getData(this, model);
	        return privateData.config.minHeight;
	    }
	    getMaxHeight(model) {
	        const privateData = getData(this, model);
	        return privateData.config.maxHeight;
	    }
	    getWidthInPx(model) {
	        const privateData = getData(this, model);
	        return privateData.config.widthInPx;
	    }
	    getHeightInPx(model) {
	        const privateData = getData(this, model);
	        return privateData.config.heightInPx;
	    }
	    getIsPinned(model) {
	        const privateData = getData(this, model);
	        return privateData.config.isPinned;
	    }
	    getIsMaximized(model) {
	        const privateData = getData(this, model);
	        return privateData.config.isMaximized;
	    }
	    getMaximizationBoundary(model) {
	        const privateData = getData(this, model);
	        return privateData.config.maximizationBoundary;
	    }
	    async setHeight(model, height) {
	        const modelData = getData(this, model);
	        const { controller, id } = modelData;
	        await controller.resizeItem(id, {
	            height
	        });
	        await this.getMyWorkspace(modelData.parent).refreshReference();
	    }
	    async setWidth(model, width) {
	        const modelData = getData(this, model);
	        const { controller, id } = modelData;
	        await controller.resizeItem(id, {
	            width
	        });
	        await this.getMyWorkspace(modelData.parent).refreshReference();
	    }
	    async setSize(model, width, height) {
	        const modelData = getData(this, model);
	        const { controller, id } = modelData;
	        await controller.resizeItem(id, {
	            width,
	            height
	        });
	        await this.getMyWorkspace(modelData.parent).refreshReference();
	    }
	    async setMaximizationBoundary(model, config) {
	        const modelData = getData(this, model);
	        const { controller, id } = modelData;
	        await controller.setMaximizationBoundary(id, config);
	        await this.getMyWorkspace(modelData.parent).refreshReference();
	    }
	    async bundleTo(model, type) {
	        const modelData = getData(this, model);
	        const { controller, id } = modelData;
	        await controller.bundleItemTo(type, id);
	    }
	    async processLocalSubscription(model, subscriptionConfig) {
	        return getData(this, model).controller.processLocalSubscription(subscriptionConfig, this.getId(model));
	    }
	    transformDefinition(type, definition) {
	        let parentDefinition;
	        if (typeof definition === "undefined") {
	            parentDefinition = { type, children: [] };
	        }
	        else if (definition instanceof ParentBuilder) {
	            parentDefinition = definition.serialize();
	        }
	        else {
	            if (typeof definition.type === "undefined") {
	                definition.type = type;
	            }
	            parentDefinition = strictParentDefinitionDecoder.runWithException(definition);
	            parentDefinition.children = parentDefinition.children || [];
	        }
	        return parentDefinition;
	    }
	}

	class BaseController {
	    ioc;
	    windows;
	    contexts;
	    layouts;
	    constructor(ioc, windows, contexts, layouts) {
	        this.ioc = ioc;
	        this.windows = windows;
	        this.contexts = contexts;
	        this.layouts = layouts;
	    }
	    get bridge() {
	        return this.ioc.bridge;
	    }
	    get privateDataManager() {
	        return this.ioc.privateDataManager;
	    }
	    checkIsWindowLoaded(windowId) {
	        return (!!windowId) && this.windows.list().some((win) => win.id === windowId);
	    }
	    async createWorkspace(createConfig) {
	        const snapshot = await this.bridge.send(OPERATIONS.createWorkspace.name, createConfig);
	        const frameConfig = {
	            summary: snapshot.frameSummary
	        };
	        const frame = this.ioc.getModel("frame", frameConfig);
	        const workspaceConfig = { frame, snapshot };
	        return this.ioc.getModel("workspace", workspaceConfig);
	    }
	    async createEmptyFrame(definition) {
	        const frameSummary = await this.bridge.send(OPERATIONS.createFrame.name, definition);
	        const frameConfig = {
	            summary: frameSummary
	        };
	        return this.ioc.getModel("frame", frameConfig);
	    }
	    async initFrame(frameId, config) {
	        await this.bridge.send(OPERATIONS.initFrame.name, { frameId, ...config });
	    }
	    async restoreWorkspace(name, options) {
	        const snapshot = await this.bridge.send(OPERATIONS.openWorkspace.name, { name, restoreOptions: options });
	        const frameSummary = await this.bridge.send(OPERATIONS.getFrameSummary.name, { itemId: snapshot.config.frameId });
	        const frameConfig = {
	            summary: frameSummary
	        };
	        const frame = this.ioc.getModel("frame", frameConfig);
	        const workspaceConfig = { frame, snapshot };
	        return this.ioc.getModel("workspace", workspaceConfig);
	    }
	    async add(type, parentId, parentType, definition) {
	        let operationName;
	        const operationArgs = { definition, parentId, parentType };
	        if (type === "window") {
	            operationName = OPERATIONS.addWindow.name;
	        }
	        else if (type === "container") {
	            operationName = OPERATIONS.addContainer.name;
	        }
	        else {
	            throw new Error(`Unrecognized add type: ${type}`);
	        }
	        return await this.bridge.send(operationName, operationArgs);
	    }
	    async getFrame(windowId) {
	        const frameSummary = await this.bridge.send(OPERATIONS.getFrameSummary.name, { itemId: windowId });
	        const frameConfig = {
	            summary: frameSummary
	        };
	        return this.ioc.getModel("frame", frameConfig);
	    }
	    getFrames(allFrameSummaries, predicate) {
	        return allFrameSummaries.reduce((frames, frameSummary) => {
	            const frameConfig = {
	                summary: frameSummary
	            };
	            const frameToCheck = this.ioc.getModel("frame", frameConfig);
	            if (!predicate || predicate(frameToCheck)) {
	                frames.push(frameToCheck);
	            }
	            return frames;
	        }, []);
	    }
	    getAllWorkspaceSummaries(...bridgeResults) {
	        const allSummaries = bridgeResults.reduce((summaries, summaryResult) => {
	            summaries.push(...summaryResult.summaries);
	            return summaries;
	        }, []);
	        return allSummaries.map((summary) => {
	            return Object.assign({}, { id: summary.id, width: summary.config.widthInPx, height: summary.config.heightInPx }, summary.config);
	        });
	    }
	    handleOnSaved(callback) {
	        const wrappedCallback = (layout) => {
	            if (layout.type !== "Workspace") {
	                return;
	            }
	            callback(layout);
	        };
	        const addedUnSub = this.layouts.onAdded(wrappedCallback);
	        const changedUnSub = this.layouts.onChanged(wrappedCallback);
	        return () => {
	            addedUnSub();
	            changedUnSub();
	        };
	    }
	    handleOnRemoved(callback) {
	        const wrappedCallback = (layout) => {
	            if (layout.type !== "Workspace") {
	                return;
	            }
	            callback(layout);
	        };
	        return this.layouts.onRemoved(wrappedCallback);
	    }
	    async importLayouts(layouts, mode) {
	        await this.layouts.import(layouts, mode);
	    }
	    async transformStreamPayloadToWorkspace(payload) {
	        const frameConfig = {
	            summary: payload.frameSummary
	        };
	        const frame = this.ioc.getModel("frame", frameConfig);
	        const snapshot = payload.workspaceSnapshot || (await this.bridge.send(OPERATIONS.getWorkspaceSnapshot.name, { itemId: payload.workspaceSummary.id }));
	        const workspaceConfig = { frame, snapshot };
	        const workspace = this.ioc.getModel("workspace", workspaceConfig);
	        return workspace;
	    }
	    async fetchWorkspace(itemId) {
	        const snapshot = await this.bridge.send(OPERATIONS.getWorkspaceSnapshot.name, { itemId });
	        const frameConfig = {
	            summary: snapshot.frameSummary
	        };
	        const frame = this.ioc.getModel("frame", frameConfig);
	        const workspaceConfig = { frame, snapshot };
	        return this.ioc.getModel("workspace", workspaceConfig);
	    }
	    async bundleWorkspaceTo(type, workspaceId) {
	        await this.bridge.send(OPERATIONS.bundleWorkspace.name, { type, workspaceId });
	    }
	    async bundleItemTo(type, itemId) {
	        const isSupported = await this.isOperationSupported(OPERATIONS.bundleItem.name);
	        if (!isSupported) {
	            throw new Error(`Operation ${OPERATIONS.bundleItem.name} is not supported. Ensure that you are running the latest version of all packages`);
	        }
	        await this.bridge.send(OPERATIONS.bundleItem.name, { type, itemId });
	    }
	    getWorkspaceContext(workspaceId) {
	        const contextName = `___workspace___${workspaceId}`;
	        return this.contexts.get(contextName);
	    }
	    setWorkspaceContext(workspaceId, data) {
	        const contextName = `___workspace___${workspaceId}`;
	        return this.contexts.set(contextName, data);
	    }
	    updateWorkspaceContext(workspaceId, data) {
	        const contextName = `___workspace___${workspaceId}`;
	        return this.contexts.update(contextName, data);
	    }
	    subscribeWorkspaceContextUpdated(workspaceId, callback) {
	        const contextName = `___workspace___${workspaceId}`;
	        return this.contexts.subscribe(contextName, callback);
	    }
	    async restoreItem(itemId) {
	        await this.bridge.send(OPERATIONS.restoreItem.name, { itemId });
	    }
	    async maximizeItem(itemId) {
	        await this.bridge.send(OPERATIONS.maximizeItem.name, { itemId });
	    }
	    async focusItem(itemId) {
	        await this.bridge.send(OPERATIONS.focusItem.name, { itemId });
	    }
	    async closeItem(itemId) {
	        await this.bridge.send(OPERATIONS.closeItem.name, { itemId });
	    }
	    async resizeItem(itemId, config) {
	        await this.bridge.send(OPERATIONS.resizeItem.name, Object.assign({}, { itemId }, config));
	    }
	    async setMaximizationBoundary(itemId, config) {
	        await this.bridge.send(OPERATIONS.setMaximizationBoundary.name, Object.assign({}, { itemId }, config));
	    }
	    async showWorkspaceLoadingAnimation(workspaceId) {
	        await this.bridge.send(OPERATIONS.showLoadingAnimation.name, { itemId: workspaceId, type: "workspace" });
	    }
	    async hideWorkspaceLoadingAnimation(workspaceId) {
	        await this.bridge.send(OPERATIONS.hideLoadingAnimation.name, { itemId: workspaceId, type: "workspace" });
	    }
	    async setWindowDragMode(workspaceId, dragMode) {
	        await this.bridge.send(OPERATIONS.setWindowDragMode.name, { itemId: workspaceId, dragMode });
	    }
	    async moveFrame(itemId, config) {
	        await this.bridge.send(OPERATIONS.moveFrame.name, Object.assign({}, { itemId }, config));
	    }
	    getGDWindow(itemId) {
	        return this.windows.list().find((gdWindow) => gdWindow.id === itemId);
	    }
	    async forceLoadWindow(itemId) {
	        const controlResult = await this.bridge.send(OPERATIONS.forceLoadWindow.name, { itemId });
	        return controlResult.windowId;
	    }
	    async ejectWindow(itemId) {
	        return await this.bridge.send(OPERATIONS.ejectWindow.name, { itemId });
	    }
	    async moveWindowTo(itemId, newParentId) {
	        await this.bridge.send(OPERATIONS.moveWindowTo.name, { itemId, containerId: newParentId });
	    }
	    async getSnapshot(itemId, type) {
	        let result;
	        if (type === "workspace") {
	            result = await this.bridge.send(OPERATIONS.getWorkspaceSnapshot.name, { itemId });
	        }
	        else if (type === "frame") {
	            result = await this.bridge.send(OPERATIONS.getFrameSnapshot.name, { itemId });
	        }
	        return result;
	    }
	    async setItemTitle(itemId, title) {
	        await this.bridge.send(OPERATIONS.setItemTitle.name, { itemId, title });
	    }
	    refreshChildren(config) {
	        const { parent, children, existingChildren, workspace } = config;
	        if (parent instanceof Window || parent.type === "window") {
	            return;
	        }
	        const newChildren = children.map((newChildSnapshot) => {
	            let childToAdd = existingChildren.find((child) => {
	                return child.type === "window" ? child.elementId === newChildSnapshot.id : child.id === newChildSnapshot.id;
	            });
	            if (childToAdd) {
	                this.privateDataManager.remapChild(childToAdd, {
	                    parent: parent,
	                    children: [],
	                    config: newChildSnapshot.config
	                });
	            }
	            else {
	                let createConfig;
	                if (newChildSnapshot.type === "window") {
	                    createConfig = {
	                        id: newChildSnapshot.id,
	                        parent: parent,
	                        frame: workspace.frame,
	                        workspace,
	                        config: newChildSnapshot.config,
	                    };
	                }
	                else {
	                    createConfig = {
	                        id: newChildSnapshot.id,
	                        parent: parent,
	                        frame: workspace.frame,
	                        workspace,
	                        config: newChildSnapshot.config,
	                        children: []
	                    };
	                }
	                childToAdd = this.ioc.getModel(newChildSnapshot.type, createConfig);
	            }
	            if (newChildSnapshot.type !== "window") {
	                this.refreshChildren({
	                    workspace, existingChildren,
	                    children: newChildSnapshot.children,
	                    parent: childToAdd
	                });
	            }
	            return childToAdd;
	        });
	        if (parent instanceof Workspace) {
	            return newChildren;
	        }
	        else {
	            this.privateDataManager.remapChild(parent, { children: newChildren });
	            return newChildren;
	        }
	    }
	    iterateFindChild(children, predicate) {
	        let foundChild = children.find((child) => predicate(child));
	        if (foundChild) {
	            return foundChild;
	        }
	        children.some((child) => {
	            if (child instanceof Window) {
	                return false;
	            }
	            foundChild = this.iterateFindChild(child.children, predicate);
	            if (foundChild) {
	                return true;
	            }
	        });
	        return foundChild;
	    }
	    iterateFilterChildren(children, predicate) {
	        const foundChildren = children.filter((child) => predicate(child));
	        const grandChildren = children.reduce((innerFound, child) => {
	            if (child instanceof Window) {
	                return innerFound;
	            }
	            innerFound.push(...this.iterateFilterChildren(child.children, predicate));
	            return innerFound;
	        }, []);
	        foundChildren.push(...grandChildren);
	        return foundChildren;
	    }
	    notifyWindowAdded(windowId) {
	        return new Promise((resolve) => {
	            const alreadyPresent = this.windows.list().some((win) => win.id === windowId);
	            if (alreadyPresent) {
	                return resolve();
	            }
	            const unsubscribe = this.windows.onWindowAdded((win) => {
	                if (win.id !== windowId) {
	                    return;
	                }
	                if (unsubscribe) {
	                    unsubscribe();
	                }
	                resolve();
	            });
	        });
	    }
	    async hibernateWorkspace(workspaceId) {
	        await this.bridge.send(OPERATIONS.hibernateWorkspace.name, { workspaceId });
	    }
	    async resumeWorkspace(workspaceId) {
	        await this.bridge.send(OPERATIONS.resumeWorkspace.name, { workspaceId });
	    }
	    async lockWorkspace(workspaceId, config) {
	        await this.bridge.send(OPERATIONS.lockWorkspace.name, { workspaceId, config });
	    }
	    async lockWindow(windowPlacementId, config) {
	        await this.bridge.send(OPERATIONS.lockWindow.name, { windowPlacementId, config });
	    }
	    async lockContainer(itemId, type, config) {
	        await this.bridge.send(OPERATIONS.lockContainer.name, { itemId, type, config });
	    }
	    async pinWorkspace(workspaceId, icon) {
	        await this.bridge.send(OPERATIONS.pinWorkspace.name, { workspaceId, icon });
	    }
	    async unpinWorkspace(workspaceId) {
	        await this.bridge.send(OPERATIONS.unpinWorkspace.name, { workspaceId });
	    }
	    async getWorkspaceIcon(workspaceId) {
	        const result = await this.bridge.send(OPERATIONS.getWorkspaceIcon.name, { workspaceId });
	        return result.icon;
	    }
	    setWorkspaceIcon(workspaceId, icon) {
	        return this.bridge.send(OPERATIONS.setWorkspaceIcon.name, { workspaceId, icon });
	    }
	    async getPlatformFrameId() {
	        try {
	            const result = await this.bridge.send(OPERATIONS.getPlatformFrameId.name, {});
	            return result;
	        }
	        catch (error) {
	            return {};
	        }
	    }
	    async setLoadingStrategy(workspaceId, strategy) {
	        await this.isOperationSupported(OPERATIONS.setLoadingStrategy.name);
	        return this.bridge.send(OPERATIONS.setLoadingStrategy.name, { itemId: workspaceId, strategy });
	    }
	    async isOperationSupported(operation) {
	        if (isDesktop()) {
	            return { isSupported: true };
	        }
	        return await this.bridge.send(OPERATIONS.operationCheck.name, { operation });
	    }
	}

	class MainController {
	    bridge;
	    base;
	    shortcutsController;
	    constructor(bridge, base, shortcutsController) {
	        this.bridge = bridge;
	        this.base = base;
	        this.shortcutsController = shortcutsController;
	    }
	    checkIsWindowLoaded(windowId) {
	        return this.base.checkIsWindowLoaded(windowId);
	    }
	    async checkIsInSwimlane(windowId) {
	        const controlResult = await this.bridge.send(OPERATIONS.isWindowInWorkspace.name, { itemId: windowId });
	        return controlResult.inWorkspace;
	    }
	    async createWorkspace(definition, saveConfig) {
	        const createConfig = Object.assign({}, definition, { saveConfig });
	        return await this.base.createWorkspace(createConfig);
	    }
	    async createEmptyFrame(definition) {
	        return await this.base.createEmptyFrame(definition);
	    }
	    async initFrame(frameId, config) {
	        return this.base.initFrame(frameId, config);
	    }
	    async restoreWorkspace(name, options) {
	        const allLayouts = await this.getLayoutSummaries();
	        const layoutExists = allLayouts.some((summary) => summary.name === name);
	        if (!layoutExists) {
	            throw new Error(`This layout: ${name} cannot be restored, because it doesn't exist.`);
	        }
	        if (options?.frameId) {
	            const allFrameSummaries = await this.bridge.send(OPERATIONS.getAllFramesSummaries.name);
	            const foundMatchingFrame = allFrameSummaries.summaries.some((summary) => summary.id === options.frameId);
	            if (!foundMatchingFrame) {
	                throw new Error(`Cannot reuse the frame with id: ${options.frameId}, because there is no frame with that ID found`);
	            }
	        }
	        return await this.base.restoreWorkspace(name, options);
	    }
	    async add(type, parentId, parentType, definition) {
	        return await this.base.add(type, parentId, parentType, definition);
	    }
	    processLocalSubscription(config, levelId) {
	        return isDesktop() ?
	            this.handleEnterpriseLocalSubscription(config, levelId) :
	            this.handleCoreLocalSubscription(config, levelId);
	    }
	    processGlobalSubscription(callback, eventType, action) {
	        return isDesktop() ?
	            this.handleEnterpriseGlobalSubscription(callback, eventType, action) :
	            this.handleCoreGlobalSubscription(callback, eventType, action);
	    }
	    async getFrame(selector) {
	        if (selector.windowId) {
	            return await this.base.getFrame(selector.windowId);
	        }
	        if (selector.predicate) {
	            return (await this.getFrames(selector.predicate))[0];
	        }
	        throw new Error(`The provided selector is not valid: ${JSON.stringify(selector)}`);
	    }
	    async getFrames(predicate) {
	        const allFrameSummaries = await this.bridge.send(OPERATIONS.getAllFramesSummaries.name);
	        return this.base.getFrames(allFrameSummaries.summaries, predicate);
	    }
	    getWorkspaceById(workspaceId) {
	        return this.base.fetchWorkspace(workspaceId);
	    }
	    async getWorkspaceByWindowId(itemId) {
	        if (!isDesktop()) {
	            return (await this.getWorkspaces((wsp) => !!wsp.getWindow((w) => w.id === itemId)))[0];
	        }
	        return this.base.fetchWorkspace(itemId);
	    }
	    transformStreamPayloadToWorkspace(payload) {
	        return this.base.transformStreamPayloadToWorkspace(payload);
	    }
	    async getWorkspace(predicate) {
	        let foundWorkspace;
	        await this.iterateWorkspaces((wsp, end) => {
	            if (predicate(wsp)) {
	                foundWorkspace = wsp;
	                end();
	            }
	        });
	        return foundWorkspace;
	    }
	    async getWorkspaces(predicate) {
	        const matchingWorkspaces = [];
	        await this.iterateWorkspaces((wsp) => {
	            if (!predicate || predicate(wsp)) {
	                matchingWorkspaces.push(wsp);
	            }
	        });
	        return matchingWorkspaces;
	    }
	    async getWorkspacesByFrameId(frameId) {
	        const workspaceSummaries = await this.getAllWorkspaceSummaries();
	        const summariesForFrame = workspaceSummaries.filter((s) => s.frameId === frameId);
	        const workspacesForFrame = await Promise.all(summariesForFrame.map((summary) => {
	            return this.base.fetchWorkspace(summary.id);
	        }));
	        return workspacesForFrame;
	    }
	    async getAllWorkspaceSummaries() {
	        const allSummariesResult = await this.bridge.send(OPERATIONS.getAllWorkspacesSummaries.name, {});
	        return this.base.getAllWorkspaceSummaries(allSummariesResult);
	    }
	    async getWindow(predicate) {
	        let resultWindow;
	        await this.iterateWorkspaces((wsp, end) => {
	            const foundWindow = wsp.getWindow(predicate);
	            if (foundWindow) {
	                resultWindow = foundWindow;
	                end();
	            }
	        });
	        return resultWindow;
	    }
	    async getParent(predicate) {
	        let resultParent;
	        await this.iterateWorkspaces((wsp, end) => {
	            const foundParent = wsp.getBox(predicate);
	            if (foundParent) {
	                resultParent = foundParent;
	                end();
	            }
	        });
	        return resultParent;
	    }
	    async getLayoutSummaries() {
	        const allLayouts = await this.bridge.send(OPERATIONS.getAllLayoutsSummaries.name);
	        return allLayouts.summaries;
	    }
	    async deleteLayout(name) {
	        await this.bridge.send(OPERATIONS.deleteLayout.name, { name });
	    }
	    async exportLayout(predicate) {
	        const allLayoutsResult = await this.bridge.send(OPERATIONS.exportAllLayouts.name);
	        return allLayoutsResult.layouts.reduce((matchingLayouts, layout) => {
	            if (!predicate || predicate(layout)) {
	                matchingLayouts.push(layout);
	            }
	            return matchingLayouts;
	        }, []);
	    }
	    async saveLayout(config) {
	        return await this.bridge.send(OPERATIONS.saveLayout.name, config);
	    }
	    async importLayouts(layouts, mode) {
	        if (isDesktop()) {
	            try {
	                await this.bridge.send(OPERATIONS.importLayouts.name, { layouts, mode });
	            }
	            catch (error) {
	                await Promise.all(layouts.map((layout) => this.bridge.send(OPERATIONS.importLayout.name, { layout, mode })));
	            }
	            return;
	        }
	        await this.base.importLayouts(layouts, mode);
	    }
	    handleOnSaved(callback) {
	        return this.base.handleOnSaved(callback);
	    }
	    handleOnRemoved(callback) {
	        return this.base.handleOnRemoved(callback);
	    }
	    async bundleWorkspaceTo(type, workspaceId) {
	        return await this.base.bundleWorkspaceTo(type, workspaceId);
	    }
	    async bundleItemTo(type, id) {
	        return await this.base.bundleItemTo(type, id);
	    }
	    getWorkspaceContext(workspaceId) {
	        return this.base.getWorkspaceContext(workspaceId);
	    }
	    setWorkspaceContext(workspaceId, data) {
	        return this.base.setWorkspaceContext(workspaceId, data);
	    }
	    updateWorkspaceContext(workspaceId, data) {
	        return this.base.updateWorkspaceContext(workspaceId, data);
	    }
	    subscribeWorkspaceContextUpdated(workspaceId, callback) {
	        return this.base.subscribeWorkspaceContextUpdated(workspaceId, callback);
	    }
	    async restoreItem(itemId) {
	        return await this.base.restoreItem(itemId);
	    }
	    async maximizeItem(itemId) {
	        return await this.base.maximizeItem(itemId);
	    }
	    async focusItem(itemId) {
	        return await this.base.focusItem(itemId);
	    }
	    async changeFrameState(frameId, state) {
	        await this.bridge.send(OPERATIONS.changeFrameState.name, { frameId, requestedState: state });
	    }
	    async getFrameBounds(frameId) {
	        const frameResult = await this.bridge.send(OPERATIONS.getFrameBounds.name, { itemId: frameId });
	        return frameResult.bounds;
	    }
	    async getFrameState(frameId) {
	        const frameResult = await this.bridge.send(OPERATIONS.getFrameState.name, { itemId: frameId });
	        return frameResult.state;
	    }
	    async closeItem(itemId) {
	        return await this.base.closeItem(itemId);
	    }
	    async resizeItem(itemId, config) {
	        return await this.base.resizeItem(itemId, config);
	    }
	    async setMaximizationBoundary(itemId, config) {
	        return await this.base.setMaximizationBoundary(itemId, config);
	    }
	    async showWorkspaceLoadingAnimation(workspaceId) {
	        return await this.base.showWorkspaceLoadingAnimation(workspaceId);
	    }
	    async hideWorkspaceLoadingAnimation(workspaceId) {
	        return await this.base.hideWorkspaceLoadingAnimation(workspaceId);
	    }
	    async setWindowDragMode(workspaceId, dragMode) {
	        return await this.base.setWindowDragMode(workspaceId, dragMode);
	    }
	    async moveFrame(itemId, config) {
	        return await this.base.moveFrame(itemId, config);
	    }
	    getGDWindow(itemId) {
	        return this.base.getGDWindow(itemId);
	    }
	    async forceLoadWindow(itemId) {
	        const windowId = await this.base.forceLoadWindow(itemId);
	        await this.base.notifyWindowAdded(windowId);
	        return windowId;
	    }
	    async ejectWindow(itemId) {
	        const windowId = (await this.base.ejectWindow(itemId)).windowId;
	        await this.base.notifyWindowAdded(windowId);
	        return windowId;
	    }
	    async moveWindowTo(itemId, newParentId) {
	        return await this.base.moveWindowTo(itemId, newParentId);
	    }
	    async getSnapshot(itemId, type) {
	        return await this.base.getSnapshot(itemId, type);
	    }
	    async setItemTitle(itemId, title) {
	        return await this.base.setItemTitle(itemId, title);
	    }
	    flatChildren(children) {
	        return children.reduce((soFar, child) => {
	            soFar.push(child);
	            if (child.type !== "window") {
	                soFar.push(...this.flatChildren(child.children));
	            }
	            return soFar;
	        }, []);
	    }
	    refreshChildren(config) {
	        return this.base.refreshChildren(config);
	    }
	    iterateFindChild(children, predicate) {
	        return this.base.iterateFindChild(children, predicate);
	    }
	    iterateFilterChildren(children, predicate) {
	        return this.base.iterateFilterChildren(children, predicate);
	    }
	    hibernateWorkspace(workspaceId) {
	        return this.base.hibernateWorkspace(workspaceId);
	    }
	    resumeWorkspace(workspaceId) {
	        return this.base.resumeWorkspace(workspaceId);
	    }
	    lockWorkspace(workspaceId, config) {
	        return this.base.lockWorkspace(workspaceId, config);
	    }
	    lockWindow(windowPlacementId, config) {
	        return this.base.lockWindow(windowPlacementId, config);
	    }
	    lockContainer(itemId, type, config) {
	        return this.base.lockContainer(itemId, type, config);
	    }
	    pinWorkspace(workspaceId, icon) {
	        return this.base.pinWorkspace(workspaceId, icon);
	    }
	    unpinWorkspace(workspaceId) {
	        return this.base.unpinWorkspace(workspaceId);
	    }
	    getWorkspaceIcon(workspaceId) {
	        return this.base.getWorkspaceIcon(workspaceId);
	    }
	    setWorkspaceIcon(workspaceId, icon) {
	        return this.base.setWorkspaceIcon(workspaceId, icon);
	    }
	    async getFrameConstraints(frameId) {
	        const frameSnapshot = await this.getSnapshot(frameId, "frame");
	        return {
	            minWidth: frameSnapshot.config.minWidth,
	            maxWidth: frameSnapshot.config.maxWidth,
	            minHeight: frameSnapshot.config.minHeight,
	            maxHeight: frameSnapshot.config.maxHeight,
	        };
	    }
	    registerShortcut(shortcut, frameId, callback) {
	        return this.shortcutsController.registerShortcut(shortcut, frameId, callback);
	    }
	    getPlatformFrameId() {
	        return this.base.getPlatformFrameId();
	    }
	    setLoadingStrategy(workspaceId, strategy) {
	        return this.base.setLoadingStrategy(workspaceId, strategy);
	    }
	    async handleCoreLocalSubscription(config, levelId) {
	        await this.bridge.createCoreEventSubscription();
	        config.scopeId = config.scopeId || levelId;
	        if (config.eventType === "window" && config.action === "loaded") {
	            const originalCB = config.callback;
	            const wrappedCB = async (callbackData) => {
	                await this.base.notifyWindowAdded(callbackData.windowSummary.config.windowId);
	                originalCB(callbackData);
	            };
	            config.callback = wrappedCB;
	        }
	        return this.bridge.handleCoreSubscription(config);
	    }
	    handleEnterpriseLocalSubscription(config, levelId) {
	        config.scopeId = config.scopeId || levelId;
	        if (config.eventType === "window" && config.action === "loaded") {
	            const originalCB = config.callback;
	            const wrappedCB = async (callbackData) => {
	                await this.base.notifyWindowAdded(callbackData.windowSummary.config.windowId);
	                originalCB(callbackData);
	            };
	            config.callback = wrappedCB;
	        }
	        return this.bridge.subscribe(config);
	    }
	    async handleCoreGlobalSubscription(callback, eventType, action) {
	        await this.bridge.createCoreEventSubscription();
	        const config = {
	            eventType, callback, action,
	            scope: "global",
	        };
	        if (eventType === "window" && action === "loaded") {
	            const wrappedCB = async (callbackData) => {
	                await this.base.notifyWindowAdded(callbackData.windowSummary.config.windowId);
	                callback(callbackData);
	            };
	            config.callback = wrappedCB;
	        }
	        return this.bridge.handleCoreSubscription(config);
	    }
	    handleEnterpriseGlobalSubscription(callback, eventType, action) {
	        const config = {
	            eventType, callback, action,
	            scope: "global",
	        };
	        if (eventType === "window" && action === "loaded") {
	            const wrappedCB = async (callbackData) => {
	                await this.base.notifyWindowAdded(callbackData.windowSummary.config.windowId);
	                callback(callbackData);
	            };
	            config.callback = wrappedCB;
	        }
	        return this.bridge.subscribe(config);
	    }
	    async iterateWorkspaces(callback) {
	        let ended = false;
	        const end = () => { ended = true; };
	        const workspaceSummaries = await this.getAllWorkspaceSummaries();
	        for (const summary of workspaceSummaries) {
	            if (ended) {
	                return;
	            }
	            const wsp = await this.base.fetchWorkspace(summary.id);
	            callback(wsp, end);
	        }
	    }
	}

	class ShortcutsController {
	    bridge;
	    _shortcuts = CallbackFactory();
	    constructor(bridge) {
	        this.bridge = bridge;
	        this.bridge.onOperation((payload, caller) => {
	            if (payload.operation === CLIENT_OPERATIONS.shortcutClicked.name) {
	                const data = payload.data;
	                this._shortcuts.execute(`${data.frameId}-${data.shortcut}`);
	            }
	        });
	    }
	    async registerShortcut(shortcut, frameId, callback) {
	        await this.bridge.send(OPERATIONS.registerShortcut.name, { shortcut, frameId });
	        const un = this._shortcuts.add(`${frameId}-${shortcut}`, callback);
	        return () => {
	            un();
	            this.bridge.send(OPERATIONS.unregisterShortcut.name, { shortcut, frameId });
	        };
	    }
	}

	class IoC {
	    agm;
	    windows;
	    layouts;
	    contexts;
	    _controllerInstance;
	    _bridgeInstance;
	    _transportInstance;
	    _privateDataManagerInstance;
	    _parentBaseInstance;
	    _baseController;
	    _shortcutsController;
	    constructor(agm, windows, layouts, contexts) {
	        this.agm = agm;
	        this.windows = windows;
	        this.layouts = layouts;
	        this.contexts = contexts;
	    }
	    get baseController() {
	        if (!this._baseController) {
	            this._baseController = new BaseController(this, this.windows, this.contexts, this.layouts);
	        }
	        return this._baseController;
	    }
	    get controller() {
	        if (!this._controllerInstance) {
	            this._controllerInstance = new MainController(this.bridge, this.baseController, this.shortcutsController);
	        }
	        return this._controllerInstance;
	    }
	    get shortcutsController() {
	        if (!this._shortcutsController) {
	            this._shortcutsController = new ShortcutsController(this.bridge);
	        }
	        return this._shortcutsController;
	    }
	    get bridge() {
	        if (!this._bridgeInstance) {
	            this._bridgeInstance = new Bridge(this.transport, CallbackFactory());
	        }
	        return this._bridgeInstance;
	    }
	    get transport() {
	        if (!this._transportInstance) {
	            this._transportInstance = new InteropTransport(this.agm, CallbackFactory());
	        }
	        return this._transportInstance;
	    }
	    get privateDataManager() {
	        if (!this._privateDataManagerInstance) {
	            this._privateDataManagerInstance = new PrivateDataManager();
	        }
	        return this._privateDataManagerInstance;
	    }
	    get parentBase() {
	        if (!this._parentBaseInstance) {
	            this._parentBaseInstance = new Base(this.privateDataManager);
	        }
	        return this._parentBaseInstance;
	    }
	    async initiate(actualWindowId) {
	        await this.transport.initiate(actualWindowId);
	    }
	    getModel(type, createConfig) {
	        switch (type) {
	            case "frame": {
	                const newFrame = new Frame(this.privateDataManager);
	                const { summary } = createConfig;
	                const frameData = { summary, controller: this.controller };
	                this.privateDataManager.setFrameData(newFrame, frameData);
	                return newFrame;
	            }
	            case "window": {
	                const { id, parent, frame, workspace, config } = createConfig;
	                const windowPrivateData = {
	                    type: "window",
	                    controller: this.controller,
	                    config, id, parent, frame, workspace
	                };
	                const newWindow = new Window(this.privateDataManager);
	                this.privateDataManager.setWindowData(newWindow, windowPrivateData);
	                return newWindow;
	            }
	            case "row":
	            case "column":
	            case "group": {
	                const { id, children, parent, frame, workspace, config } = createConfig;
	                const newParent = type === "column" ? new Column(this.parentBase) :
	                    type === "row" ? new Row(this.parentBase) : new Group(this.parentBase);
	                const builtChildren = this.buildChildren(children, frame, workspace, newParent);
	                const parentPrivateData = {
	                    id, parent, frame, workspace,
	                    config,
	                    type,
	                    controller: this.controller,
	                    children: builtChildren,
	                };
	                this.privateDataManager.setParentData(newParent, parentPrivateData);
	                return newParent;
	            }
	            case "workspace": {
	                const { snapshot, frame } = createConfig;
	                const newWorkspace = new Workspace(this.privateDataManager);
	                const children = this.buildChildren(snapshot.children, frame, newWorkspace, newWorkspace);
	                const workspacePrivateData = {
	                    id: snapshot.id,
	                    type: "workspace",
	                    config: snapshot.config,
	                    base: this.parentBase,
	                    controller: this.controller,
	                    children, frame, ioc: this
	                };
	                this.privateDataManager.setWorkspaceData(newWorkspace, workspacePrivateData);
	                return newWorkspace;
	            }
	            default: throw new Error(`Unrecognized type: ${type}`);
	        }
	    }
	    getBuilder(config) {
	        config.definition = config.definition || {};
	        if (!Array.isArray(config.definition.children)) {
	            config.definition.children = [];
	        }
	        const baseBuilder = new BaseBuilder(this.getBuilder.bind(this));
	        switch (config.type) {
	            case "workspace": {
	                return new WorkspaceBuilder(config.definition, baseBuilder, this.controller);
	            }
	            case "row":
	            case "column":
	            case "group": {
	                config.definition.type = config.type;
	                return new ParentBuilder(config.definition, baseBuilder);
	            }
	            default: throw new Error(`Unexpected Builder creation error, provided config: ${JSON.stringify(config)}`);
	        }
	    }
	    buildChildren(children, frame, workspace, parent) {
	        return children.map((child) => {
	            switch (child.type) {
	                case "window": return this.getModel("window", {
	                    id: child.id,
	                    config: child.config,
	                    frame, workspace, parent
	                });
	                case "column": return this.getModel(child.type, {
	                    id: child.id,
	                    config: child.config,
	                    children: child.children,
	                    frame, workspace, parent
	                });
	                case "row": return this.getModel(child.type, {
	                    id: child.id,
	                    config: child.config,
	                    children: child.children,
	                    frame, workspace, parent
	                });
	                case "group": return this.getModel(child.type, {
	                    id: child.id,
	                    config: child.config,
	                    children: child.children,
	                    frame, workspace, parent
	                });
	                default: throw new Error(`Unsupported child type: ${child.type}`);
	            }
	        });
	    }
	}

	var version = "3.5.6";

	const composeAPI = (glue, ioc) => {
	    const controller = ioc.controller;
	    const inWorkspace = () => {
	        const myId = glue.windows.my().id;
	        if (!myId) {
	            throw new Error("Cannot get my frame, because my id is undefined.");
	        }
	        return controller.checkIsInSwimlane(myId);
	    };
	    const getBuilder = (config) => {
	        const validatedConfig = builderConfigDecoder.runWithException(config);
	        return ioc.getBuilder(validatedConfig);
	    };
	    const getMyFrame = async () => {
	        const windowId = glue.windows.my().id;
	        if (!windowId) {
	            throw new Error("Cannot get my frame, because my id is undefined.");
	        }
	        const isInSwimlane = await controller.checkIsInSwimlane(windowId);
	        if (!isInSwimlane) {
	            throw new Error("Cannot fetch your frame, because this window is not in a workspace");
	        }
	        return controller.getFrame({ windowId });
	    };
	    const getFrame = async (predicate) => {
	        checkThrowCallback(predicate);
	        return controller.getFrame({ predicate });
	    };
	    const getAllFrames = async (predicate) => {
	        checkThrowCallback(predicate, true);
	        return controller.getFrames(predicate);
	    };
	    const getAllWorkspacesSummaries = () => {
	        return controller.getAllWorkspaceSummaries();
	    };
	    const getMyWorkspace = async () => {
	        const myId = glue.windows.my().id;
	        if (!myId) {
	            throw new Error("Cannot get my workspace, because my id is undefined.");
	        }
	        const isInSwimlane = await controller.checkIsInSwimlane(myId);
	        if (!isInSwimlane) {
	            throw new Error("Cannot fetch your workspace, because this window is not in a workspace");
	        }
	        return await controller.getWorkspaceByWindowId(myId);
	    };
	    const getWorkspace = async (predicate) => {
	        checkThrowCallback(predicate);
	        return (await controller.getWorkspaces(predicate))[0];
	    };
	    const getWorkspaceById = async (workspaceId) => {
	        nonEmptyStringDecoder.runWithException(workspaceId);
	        return controller.getWorkspaceById(workspaceId);
	    };
	    const getAllWorkspaces = (predicate) => {
	        checkThrowCallback(predicate, true);
	        return controller.getWorkspaces(predicate);
	    };
	    const getWindow = async (predicate) => {
	        checkThrowCallback(predicate);
	        return controller.getWindow(predicate);
	    };
	    const getParent = async (predicate) => {
	        checkThrowCallback(predicate);
	        return controller.getParent(predicate);
	    };
	    const restoreWorkspace = async (name, options) => {
	        nonEmptyStringDecoder.runWithException(name);
	        const validatedOptions = restoreWorkspaceConfigDecoder.runWithException(options);
	        return controller.restoreWorkspace(name, validatedOptions);
	    };
	    const createWorkspace = async (definition, saveConfig) => {
	        const validatedDefinition = workspaceDefinitionDecoder.runWithException(definition);
	        const validatedConfig = workspaceBuilderCreateConfigDecoder.runWithException(saveConfig);
	        return controller.createWorkspace(validatedDefinition, validatedConfig);
	    };
	    const createEmptyFrame = async (definition) => {
	        const validatedDefinition = emptyFrameDefinitionDecoder.runWithException(definition);
	        return controller.createEmptyFrame(validatedDefinition ?? {});
	    };
	    const layouts = {
	        getSummaries: () => {
	            return controller.getLayoutSummaries();
	        },
	        delete: async (name) => {
	            nonEmptyStringDecoder.runWithException(name);
	            return controller.deleteLayout(name);
	        },
	        export: async (predicate) => {
	            checkThrowCallback(predicate, true);
	            return controller.exportLayout(predicate);
	        },
	        import: async (layouts, mode = "replace") => {
	            if (!Array.isArray(layouts)) {
	                throw new Error(`The provided layouts argument is not an array: ${JSON.stringify(layouts)}`);
	            }
	            layouts.forEach((layout) => workspaceLayoutDecoder.runWithException(layout));
	            return controller.importLayouts(layouts, mode);
	        },
	        save: async (config) => {
	            const verifiedConfig = workspaceLayoutSaveConfigDecoder.runWithException(config);
	            return controller.saveLayout(verifiedConfig);
	        },
	        onSaved: async (callback) => {
	            checkThrowCallback(callback);
	            return controller.handleOnSaved(callback);
	        },
	        onRemoved: async (callback) => {
	            checkThrowCallback(callback);
	            return controller.handleOnRemoved(callback);
	        }
	    };
	    const onFrameOpened = async (callback) => {
	        checkThrowCallback(callback);
	        const wrappedCallback = (payload) => {
	            const frameConfig = {
	                summary: payload.frameSummary
	            };
	            const frame = ioc.getModel("frame", frameConfig);
	            callback(frame);
	        };
	        const unsubscribe = await controller.processGlobalSubscription(wrappedCallback, "frame", "opened");
	        return unsubscribe;
	    };
	    const onFrameClosed = async (callback) => {
	        checkThrowCallback(callback);
	        const wrappedCallback = (payload) => {
	            callback({ frameId: payload.frameSummary.id, frameBounds: payload.frameBounds });
	        };
	        const unsubscribe = await controller.processGlobalSubscription(wrappedCallback, "frame", "closed");
	        return unsubscribe;
	    };
	    const onWorkspaceOpened = async (callback) => {
	        checkThrowCallback(callback);
	        const wrappedCallback = async (payload) => {
	            const workspace = await controller.transformStreamPayloadToWorkspace(payload);
	            callback(workspace);
	        };
	        const unsubscribe = await controller.processGlobalSubscription(wrappedCallback, "workspace", "opened");
	        return unsubscribe;
	    };
	    const onWorkspaceClosed = async (callback) => {
	        checkThrowCallback(callback);
	        const wrappedCallback = (payload) => {
	            callback({ frameId: payload.frameSummary.id, workspaceId: payload.workspaceSummary.id, frameBounds: payload.frameBounds });
	        };
	        const unsubscribe = await controller.processGlobalSubscription(wrappedCallback, "workspace", "closed");
	        return unsubscribe;
	    };
	    const onWorkspaceHibernated = async (callback) => {
	        checkThrowCallback(callback);
	        const wrappedCallback = async (payload) => {
	            const workspace = await controller.transformStreamPayloadToWorkspace(payload);
	            callback(workspace);
	        };
	        const unsubscribe = await controller.processGlobalSubscription(wrappedCallback, "workspace", "hibernated");
	        return unsubscribe;
	    };
	    const onWorkspaceResumed = async (callback) => {
	        checkThrowCallback(callback);
	        const wrappedCallback = async (payload) => {
	            const workspace = await controller.transformStreamPayloadToWorkspace(payload);
	            callback(workspace);
	        };
	        const unsubscribe = await controller.processGlobalSubscription(wrappedCallback, "workspace", "resumed");
	        return unsubscribe;
	    };
	    const onWindowAdded = async (callback) => {
	        checkThrowCallback(callback);
	        const wrappedCallback = async (payload) => {
	            const snapshot = (await controller.getSnapshot(payload.windowSummary.config.workspaceId, "workspace"));
	            const frameConfig = {
	                summary: snapshot.frameSummary
	            };
	            const frame = ioc.getModel("frame", frameConfig);
	            const workspaceConfig = { frame, snapshot };
	            const workspace = ioc.getModel("workspace", workspaceConfig);
	            const windowParent = workspace.getBox((parent) => parent.id === payload.windowSummary.parentId);
	            const foundWindow = windowParent.children.find((child) => child.type === "window" && child.elementId === payload.windowSummary.itemId);
	            callback(foundWindow);
	        };
	        const unsubscribe = await controller.processGlobalSubscription(wrappedCallback, "window", "added");
	        return unsubscribe;
	    };
	    const onWindowLoaded = async (callback) => {
	        checkThrowCallback(callback);
	        const wrappedCallback = async (payload) => {
	            const snapshot = (await controller.getSnapshot(payload.windowSummary.config.workspaceId, "workspace"));
	            const frameConfig = {
	                summary: snapshot.frameSummary
	            };
	            const frame = ioc.getModel("frame", frameConfig);
	            const workspaceConfig = { frame, snapshot };
	            const workspace = ioc.getModel("workspace", workspaceConfig);
	            const foundWindow = workspace.getWindow((win) => win.id && win.id === payload.windowSummary.config.windowId);
	            callback(foundWindow);
	        };
	        const unsubscribe = await controller.processGlobalSubscription(wrappedCallback, "window", "loaded");
	        return unsubscribe;
	    };
	    const onWindowRemoved = async (callback) => {
	        checkThrowCallback(callback);
	        const wrappedCallback = (payload) => {
	            const { windowId, workspaceId, frameId } = payload.windowSummary.config;
	            callback({ windowId, workspaceId, frameId });
	        };
	        const unsubscribe = await controller.processGlobalSubscription(wrappedCallback, "window", "removed");
	        return unsubscribe;
	    };
	    const onWindowMaximized = async (callback) => {
	        checkThrowCallback(callback);
	        const wrappedCallback = async (payload) => {
	            const snapshot = (await controller.getSnapshot(payload.windowSummary.config.workspaceId, "workspace"));
	            const frameConfig = {
	                summary: snapshot.frameSummary
	            };
	            const frame = ioc.getModel("frame", frameConfig);
	            const workspaceConfig = { frame, snapshot };
	            const workspace = ioc.getModel("workspace", workspaceConfig);
	            const windowParent = workspace.getBox((parent) => parent.id === payload.windowSummary.parentId);
	            const foundWindow = windowParent.children.find((child) => child.type === "window" && child.elementId === payload.windowSummary.itemId);
	            callback(foundWindow);
	        };
	        const unsubscribe = await controller.processGlobalSubscription(wrappedCallback, "window", "maximized");
	        return unsubscribe;
	    };
	    const onWindowRestored = async (callback) => {
	        checkThrowCallback(callback);
	        const wrappedCallback = async (payload) => {
	            const snapshot = (await controller.getSnapshot(payload.windowSummary.config.workspaceId, "workspace"));
	            const frameConfig = {
	                summary: snapshot.frameSummary
	            };
	            const frame = ioc.getModel("frame", frameConfig);
	            const workspaceConfig = { frame, snapshot };
	            const workspace = ioc.getModel("workspace", workspaceConfig);
	            const windowParent = workspace.getBox((parent) => parent.id === payload.windowSummary.parentId);
	            const foundWindow = windowParent.children.find((child) => child.type === "window" && child.elementId === payload.windowSummary.itemId);
	            callback(foundWindow);
	        };
	        const unsubscribe = await controller.processGlobalSubscription(wrappedCallback, "window", "restored");
	        return unsubscribe;
	    };
	    const onWindowSelected = async (callback) => {
	        checkThrowCallback(callback);
	        const wrappedCallback = async (payload) => {
	            const snapshot = (await controller.getSnapshot(payload.windowSummary.config.workspaceId, "workspace"));
	            const frameConfig = {
	                summary: snapshot.frameSummary
	            };
	            const frame = ioc.getModel("frame", frameConfig);
	            const workspaceConfig = { frame, snapshot };
	            const workspace = ioc.getModel("workspace", workspaceConfig);
	            const windowParent = workspace.getBox((parent) => parent.id === payload.windowSummary.parentId);
	            const foundWindow = windowParent.children.find((child) => child.type === "window" && child.elementId === payload.windowSummary.itemId);
	            callback(foundWindow);
	        };
	        const unsubscribe = await controller.processGlobalSubscription(wrappedCallback, "window", "selected");
	        return unsubscribe;
	    };
	    const waitForFrame = async (id) => {
	        nonEmptyStringDecoder.runWithException(id);
	        return new Promise((res, rej) => {
	            let unsub = () => {
	            };
	            onFrameOpened((f) => {
	                if (f.id === id) {
	                    res(f);
	                    unsub();
	                }
	            }).then((u) => {
	                unsub = u;
	                return getAllFrames();
	            }).then((frames) => {
	                const myFrame = frames.find((f) => f.id === id);
	                if (myFrame) {
	                    res(myFrame);
	                    unsub();
	                }
	            }).catch(rej);
	        });
	    };
	    return {
	        inWorkspace,
	        getBuilder,
	        getMyFrame,
	        getFrame,
	        getAllFrames,
	        getAllWorkspacesSummaries,
	        getMyWorkspace,
	        getWorkspace,
	        getWorkspaceById,
	        getAllWorkspaces,
	        getWindow,
	        getBox: getParent,
	        restoreWorkspace,
	        createWorkspace,
	        createEmptyFrame,
	        waitForFrame,
	        layouts,
	        onFrameOpened,
	        onFrameClosed,
	        onWorkspaceOpened,
	        onWorkspaceClosed,
	        onWorkspaceHibernated,
	        onWorkspaceResumed,
	        onWindowAdded,
	        onWindowLoaded,
	        onWindowRemoved,
	        onWindowMaximized,
	        onWindowRestored,
	        onWindowSelected,
	        version
	    };
	};

	const factoryFunction = async (io) => {
	    const ioc = new IoC(io.agm, io.windows, io.layouts, io.contexts);
	    const actualWindowId = io.interop.instance.windowId;
	    await ioc.initiate(actualWindowId);
	    io.workspaces = composeAPI(io, ioc);
	};
	if (typeof window !== "undefined") {
	    window.IOWorkspaces = factoryFunction;
	}

	return factoryFunction;

}));
//# sourceMappingURL=workspaces.umd.js.map
