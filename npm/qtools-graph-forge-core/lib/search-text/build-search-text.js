#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// build-search-text.js — the ONE shared searchText builder (contract §1C, DESIGN §C, DECISIONS §8/§23-R4)
//
// Composes a pipe-delimited searchText identically for every standard, from the
// canonical role + structural context (name + owning context), NEVER from description.
// A DmeProperty carries its owning Class name; a DmeOptionValue carries its set + owner.
// Empty result throws a descriptive ValidationError at FORGE time naming the offending element.

// -----
// ValidationError — a real Error subclass (instanceof Error === true), so callers
// can distinguish a forge-time data fault from an operational error.

class ValidationError extends Error {
	constructor(message) {
		super(message);
		this.name = 'ValidationError';
	}
}

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	(unusedDeps = {}) => {
		// -----
		// cleanSegment — coerce, trim; null/undefined/'' become null (dropped from the pipe join)

		const cleanSegment = (value) => {
			if (value == null) {
				return null;
			}
			const trimmed = `${value}`.trim();
			return trimmed === '' ? null : trimmed;
		};

		// -----
		// segmentBuildersByRole — registry of per-role segment composers (no switch).
		//   Each returns an ordered array of raw segments; cleanSegment + pipe-join happens once.
		//   Built from structural context only — description is deliberately never read here.

		const segmentBuildersByRole = {
			DmeStandardRoot: ({ name, standardName }) => [standardName, name],

			DmeClass: ({ name, standardName, owningName }) => [
				standardName,
				owningName,
				name,
			],

			// a Property ALWAYS carries its owning Class name (the CEDS hub fix)
			DmeProperty: ({ name, owningClassName, owningName }) => [
				owningClassName || owningName,
				name,
			],

			DmeOptionSet: ({ name, owningClassName, owningName }) => [
				owningClassName || owningName,
				name,
			],

			// an OptionValue ALWAYS carries its set + owner
			DmeOptionValue: ({ name, optionSetName, owningName, owningClassName }) => [
				owningClassName,
				owningName || optionSetName,
				optionSetName,
				name,
			],

			DmeSupport: ({ name, owningName, standardName }) => [
				standardName,
				owningName,
				name,
			],
		};

		// -----
		// elementDescriptor — a human-identifiable label for the offending element in errors.

		const elementDescriptor = (element = {}) => {
			const { role, name, owningClassName, optionSetName, owningName } = element;
			const parts = [
				role ? `role=${role}` : null,
				name ? `name='${name}'` : 'name=<empty>',
				owningClassName ? `owningClass='${owningClassName}'` : null,
				optionSetName ? `optionSet='${optionSetName}'` : null,
				owningName && owningName !== owningClassName
					? `owner='${owningName}'`
					: null,
			].filter((one) => one != null);
			return parts.join(', ');
		};

		// -----
		// buildSearchText — compose the pipe-delimited searchText for one element.
		//   element: { role, name, owningClassName, optionSetName, owningName, standardName, ... }
		//   Returns a non-empty pipe-delimited string, or throws ValidationError naming the element.

		const buildSearchText = (element = {}) => {
			const { role } = element;

			const builder = segmentBuildersByRole[role];

			if (!builder) {
				throw new ValidationError(
					`buildSearchText: cannot build searchText — unknown or missing role for element [${elementDescriptor(element)}]`,
				);
			}

			const searchText = builder(element)
				.map(cleanSegment)
				.filter((one) => one != null)
				.join(' | ');

			if (searchText === '') {
				throw new ValidationError(
					`buildSearchText: cannot build a non-empty searchText for element [${elementDescriptor(element)}] — no usable name or structural context`,
				);
			}

			return searchText;
		};

		return { buildSearchText, ValidationError };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
