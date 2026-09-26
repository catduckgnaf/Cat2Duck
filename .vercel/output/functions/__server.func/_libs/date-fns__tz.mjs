//#region node_modules/@date-fns/tz/tzName/index.js
/**
* Time zone name format.
*/
/**
* The function returns the time zone name for the given date in the specified
* time zone.
*
* It uses the `Intl.DateTimeFormat` API and by default outputs the time zone
* name in a long format, e.g. "Pacific Standard Time" or
* "Singapore Standard Time".
*
* It is possible to specify the format as the third argument using one of the following options
*
* - "short": e.g. "EDT" or "GMT+8".
* - "long": e.g. "Eastern Daylight Time".
* - "shortGeneric": e.g. "ET" or "Singapore Time".
* - "longGeneric": e.g. "Eastern Time" or "Singapore Standard Time".
*
* These options correspond to TR35 tokens `z..zzz`, `zzzz`, `v`, and `vvvv` respectively: https://www.unicode.org/reports/tr35/tr35-dates.html#dfst-zone
*
* @param timeZone - Time zone name (IANA or UTC offset)
* @param date - Date object to get the time zone name for
* @param format - Optional format of the time zone name. Defaults to "long". Can be "short", "long", "shortGeneric", or "longGeneric".
*
* @returns Time zone name (e.g. "Singapore Standard Time")
*/
function tzName(timeZone, date, format = "long") {
	return new Intl.DateTimeFormat("en-US", {
		hour: "numeric",
		timeZone,
		timeZoneName: format
	}).format(date).split(/\s/g).slice(2).join(" ");
}
//#endregion
//#region node_modules/@date-fns/tz/tzOffset/index.js
var offsetFormatCache = {};
var offsetCache = {};
/**
* The function returns UTC offset in minutes for the given date in specified
* time zone.
*
* Unlike `Date.prototype.getTimezoneOffset`, this function returns the value
* mirrored to the sign of the offset in the time zone. For Asia/Singapore
* (UTC+8), `tzOffset` returns `480`, while `getTimezoneOffset` returns `-480`.
*
* It uses `Intl.DateTimeFormat` internally to access otherwise unavailable
* runtime's time zone data, and falls back to basic manual parsing if Intl API
* is not supported (e.g., older Node.js versions, React Native's Hermes, etc.).
*
* @param timeZone - Time zone name (IANA or UTC offset).
* @param date - Date to check the offset for.
*
* @returns UTC offset in minutes (e.g., `480` for date in UTC+8).
*/
function tzOffset(timeZone, date) {
	try {
		const offsetStr = (offsetFormatCache[timeZone] ||= new Intl.DateTimeFormat("en-US", {
			timeZone,
			timeZoneName: "longOffset"
		}).format)(date).split("GMT")[1];
		if (offsetStr in offsetCache) return offsetCache[offsetStr];
		return calcOffset(offsetStr, offsetStr.split(":"));
	} catch {
		if (timeZone in offsetCache) return offsetCache[timeZone];
		const captures = timeZone?.match(offsetRe);
		if (captures) return calcOffset(timeZone, captures.slice(1));
		return NaN;
	}
}
var offsetRe = /([+-]\d\d):?(\d\d)?/;
function calcOffset(cacheStr, values) {
	const hours = +(values[0] || 0);
	const minutes = +(values[1] || 0);
	const seconds = +(values[2] || 0) / 60;
	return offsetCache[cacheStr] = hours * 60 + minutes > 0 ? hours * 60 + minutes + seconds : hours * 60 - minutes - seconds;
}
//#endregion
//#region node_modules/@date-fns/tz/date/mini.js
var TZDateMini = class TZDateMini extends Date {
	constructor(...args) {
		super();
		if (args.length > 1 && typeof args[args.length - 1] === "string") this.timeZone = args.pop();
		this.internal = /* @__PURE__ */ new Date();
		if (isNaN(tzOffset(this.timeZone, this))) this.setTime(NaN);
		else if (!args.length) this.setTime(Date.now());
		else if (typeof args[0] === "number" && (args.length === 1 || args.length === 2 && typeof args[1] !== "number")) this.setTime(args[0]);
		else if (typeof args[0] === "string") this.setTime(+new Date(args[0]));
		else if (args[0] instanceof Date) this.setTime(+args[0]);
		else {
			this.setTime(+new Date(...args));
			adjustToSystemTZ(this, args);
		}
	}
	static tz(tz, ...args) {
		return args.length ? new TZDateMini(...args, tz) : new TZDateMini(Date.now(), tz);
	}
	withTimeZone(timeZone) {
		return new TZDateMini(+this, timeZone);
	}
	getTimezoneOffset() {
		const offset = -tzOffset(this.timeZone, this);
		return offset > 0 ? Math.floor(offset) : Math.ceil(offset);
	}
	setTime(_time) {
		Date.prototype.setTime.apply(this, arguments);
		syncToInternal(this);
		return +this;
	}
	[Symbol.for("constructDateFrom")](date) {
		return new TZDateMini(+new Date(date), this.timeZone);
	}
};
var re = /^(get|set)(?!UTC)/;
Object.getOwnPropertyNames(Date.prototype).forEach((method) => {
	if (!re.test(method)) return;
	const utcMethod = method.replace(re, "$1UTC");
	if (!TZDateMini.prototype[utcMethod]) return;
	if (method.startsWith("get")) TZDateMini.prototype[method] = function() {
		return this.internal[utcMethod]();
	};
	else {
		TZDateMini.prototype[method] = function() {
			Date.prototype[utcMethod].apply(this.internal, arguments);
			syncFromInternal(this);
			return +this;
		};
		TZDateMini.prototype[utcMethod] = function() {
			Date.prototype[utcMethod].apply(this, arguments);
			syncToInternal(this);
			return +this;
		};
	}
});
/**
* @internal
* Function syncs time to internal date, applying the current time zone offset.
*
* @param {Date} date - `Date` to sync
*/
function syncToInternal(date) {
	date.internal.setTime(+date);
	date.internal.setUTCSeconds(date.internal.getUTCSeconds() - Math.round(-tzOffset(date.timeZone, date) * 60));
}
/**
* @internal
* Function syncs internal wall-clock fields into the external date.
*
* @param {Date} date - The date to sync
*/
function syncFromInternal(date) {
	Date.prototype.setFullYear.call(date, date.internal.getUTCFullYear(), date.internal.getUTCMonth(), date.internal.getUTCDate());
	Date.prototype.setHours.call(date, date.internal.getUTCHours(), date.internal.getUTCMinutes(), date.internal.getUTCSeconds(), date.internal.getUTCMilliseconds());
	adjustToSystemTZ(date);
}
/**
* @internal
* Function adjusts the date to the system time zone. It uses the time zone
* differences to calculate the offset and adjust the date.
*
* We use it when constructing `TZDate` and syncing the external date from
* the internal one.
*
* @param {TZDate} date - `TZDate` to adjust.
*/
function adjustToSystemTZ(date, constructorArgs) {
	const expectedInternalTime = Array.isArray(constructorArgs) ? constructorArgsToInternalTime(constructorArgs) : +date.internal;
	const offsetWithSeconds = tzOffset(date.timeZone, date);
	const offset = offsetWithSeconds > 0 ? Math.floor(offsetWithSeconds) : Math.ceil(offsetWithSeconds);
	const prevHour = /* @__PURE__ */ new Date(+date);
	prevHour.setUTCHours(prevHour.getUTCHours() - 1);
	const systemOffset = -(/* @__PURE__ */ new Date(+date)).getTimezoneOffset();
	const prevHourSystemOffset = -(/* @__PURE__ */ new Date(+prevHour)).getTimezoneOffset();
	const systemDSTChange = systemOffset - prevHourSystemOffset;
	let systemOffsetForDiff = systemOffset;
	if (systemDSTChange && systemOffset !== offset) {
		if (Date.prototype.getHours.apply(date) !== (Array.isArray(constructorArgs) ? constructorArgs[3] || 0 : date.internal.getUTCHours())) {
			const testDate = /* @__PURE__ */ new Date(+date);
			const testOffsetDiff = systemOffset - offset;
			if (testOffsetDiff) testDate.setUTCMinutes(testDate.getUTCMinutes() + testOffsetDiff);
			const testOffsetWithSeconds = tzOffset(date.timeZone, testDate);
			if ((testOffsetWithSeconds > 0 ? Math.floor(testOffsetWithSeconds) : Math.ceil(testOffsetWithSeconds)) === offset) systemOffsetForDiff = prevHourSystemOffset;
		}
	}
	const offsetDiff = systemOffsetForDiff - offset;
	if (offsetDiff) Date.prototype.setUTCMinutes.call(date, Date.prototype.getUTCMinutes.call(date) + offsetDiff);
	const systemDate = /* @__PURE__ */ new Date(+date);
	systemDate.setUTCSeconds(0);
	const systemSecondsOffset = systemOffset > 0 ? systemDate.getSeconds() : (systemDate.getSeconds() - 60) % 60;
	const secondsOffset = Math.round(-(tzOffset(date.timeZone, date) * 60)) % 60;
	if (secondsOffset || systemSecondsOffset) Date.prototype.setUTCSeconds.call(date, Date.prototype.getUTCSeconds.call(date) + secondsOffset + systemSecondsOffset);
	const postOffsetWithSeconds = tzOffset(date.timeZone, date);
	const postOffset = postOffsetWithSeconds > 0 ? Math.floor(postOffsetWithSeconds) : Math.ceil(postOffsetWithSeconds);
	const postOffsetDiff = -(/* @__PURE__ */ new Date(+date)).getTimezoneOffset() - postOffset;
	const offsetChanged = postOffset !== offset;
	const postDiff = postOffsetDiff - offsetDiff;
	const targetDSTShift = postOffset - offset;
	const postOffsetCandidate = expectedInternalTime - postOffset * 60 * 1e3;
	const normalizedTargetDSTGap = targetDSTShift > 0 && targetInternalTime(date) - expectedInternalTime === targetDSTShift * 60 * 1e3 && targetInternalTime(date, postOffsetCandidate) !== expectedInternalTime;
	if (offsetChanged && postDiff && !normalizedTargetDSTGap) {
		Date.prototype.setUTCMinutes.call(date, Date.prototype.getUTCMinutes.call(date) + postDiff);
		const newOffsetWithSeconds = tzOffset(date.timeZone, date);
		const offsetChange = postOffset - (newOffsetWithSeconds > 0 ? Math.floor(newOffsetWithSeconds) : Math.ceil(newOffsetWithSeconds));
		if (offsetChange && postDiff < 0) Date.prototype.setUTCMinutes.call(date, Date.prototype.getUTCMinutes.call(date) + offsetChange);
	}
	syncToInternal(date);
	const drift = (constructorArgs ? expectedInternalTime : expectedInternalTime + secondsOffset * 1e3) - +date.internal;
	if (drift && Math.abs(drift) < 18e5) {
		Date.prototype.setTime.call(date, +date + drift);
		syncToInternal(date);
	}
}
function constructorArgsToInternalTime(args) {
	return Date.UTC(args[0], args.length > 1 ? args[1] : 0, args.length > 2 ? args[2] : 1, ...args.slice(3));
}
function targetInternalTime(date, time) {
	const internal = new Date(time ?? +date);
	internal.setUTCSeconds(internal.getUTCSeconds() - Math.round(-tzOffset(date.timeZone, internal) * 60));
	return +internal;
}
//#endregion
//#region node_modules/@date-fns/tz/date/index.js
var TZDate = class TZDate extends TZDateMini {
	static tz(tz, ...args) {
		return args.length ? new TZDate(...args, tz) : new TZDate(Date.now(), tz);
	}
	toISOString() {
		const [sign, hours, minutes] = this.tzComponents();
		const tz = `${sign}${hours}:${minutes}`;
		return this.internal.toISOString().slice(0, -1) + tz;
	}
	toString() {
		return `${this.toDateString()} ${this.toTimeString()}`;
	}
	toDateString() {
		const [day, date, month, year] = this.internal.toUTCString().split(" ");
		return `${day?.slice(0, -1)} ${month} ${date} ${year}`;
	}
	toTimeString() {
		const time = this.internal.toUTCString().split(" ")[4];
		const [sign, hours, minutes] = this.tzComponents();
		return `${time} GMT${sign}${hours}${minutes} (${tzName(this.timeZone, this)})`;
	}
	toLocaleString(locales, options) {
		return Date.prototype.toLocaleString.call(this, locales, {
			...options,
			timeZone: options?.timeZone || this.timeZone
		});
	}
	toLocaleDateString(locales, options) {
		return Date.prototype.toLocaleDateString.call(this, locales, {
			...options,
			timeZone: options?.timeZone || this.timeZone
		});
	}
	toLocaleTimeString(locales, options) {
		return Date.prototype.toLocaleTimeString.call(this, locales, {
			...options,
			timeZone: options?.timeZone || this.timeZone
		});
	}
	tzComponents() {
		const offset = this.getTimezoneOffset();
		return [
			offset > 0 ? "-" : "+",
			String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0"),
			String(Math.abs(offset) % 60).padStart(2, "0")
		];
	}
	withTimeZone(timeZone) {
		return new TZDate(+this, timeZone);
	}
	[Symbol.for("constructDateFrom")](date) {
		return new TZDate(+new Date(date), this.timeZone);
	}
};
//#endregion
export { TZDate as t };
