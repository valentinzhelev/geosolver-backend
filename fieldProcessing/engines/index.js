/**
 * Field Processing engines — public API. Pure: no Express, no database.
 */
const registry = require('./registry');
const angleUnits = require('./angleUnits');
const { EngineError, isEngineError } = require('../../engines/errors');

module.exports = { ...registry, ...angleUnits, EngineError, isEngineError };
