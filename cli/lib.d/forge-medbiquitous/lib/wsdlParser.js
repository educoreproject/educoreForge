'use strict';

// wsdlParser.js — regex-based MedBiquitous WSDL extractor.
//
// WSDLs in MedBiquitous come in two flavours:
//   • <standard>service.wsdl   — service + port (lightweight wrapper)
//   • <standard>bindings.wsdl  — portType + operations + messages + binding
//
// The WSDL element names use the `wsdl:` prefix when the WSDL
// namespace is bound to that prefix, OR they appear unprefixed when
// the default xmlns is the WSDL namespace. We detect the prefix the
// same way xsdParser detects XSD prefix.
//
// Returns:
//   {
//     prefix:        '' | 'wsdl',
//     targetNamespace: string,
//     namespaceMap:  { [prefix]: string },
//     imports:       [{ namespace, location }],
//     messages:      [{ name, parts: [{ name, element, type }], documentation }],
//     portTypes:     [{ name, operations: [{ name, input, output, faults, documentation }], documentation }],
//     bindings:      [{ name, type, transport, style, operations: [{ name, soapAction }], documentation }],
//     services:      [{ name, ports: [{ name, binding, location }], documentation }]
//   }

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeLineEndings = (text) => text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

const detectPrefix = (wsdlText) => {
	// Look for either <wsdl:definitions or <definitions (default ns case)
	const prefMatch = wsdlText.match(/<(\w+):definitions\b/);
	if (prefMatch) { return prefMatch[1]; }
	return ''; // empty = default namespace
};

const elementName = (prefix, name) => prefix ? prefix + ':' + name : name;

const extractTargetNamespace = (wsdlText) => {
	const m = wsdlText.match(/<(?:\w+:)?definitions\b[^>]*?\btargetNamespace="([^"]+)"/);
	return m ? m[1] : '';
};

const buildNamespaceMap = (wsdlText) => {
	const map = {};
	const open = wsdlText.match(/<(?:\w+:)?definitions\b[^>]*>/);
	if (!open) { return map; }
	const head = open[0];
	const pattern = /xmlns(?::(\w+))?="([^"]+)"/g;
	let m;
	while ((m = pattern.exec(head)) !== null) {
		const prefix = m[1] || '';
		const uri = m[2];
		map[prefix] = uri;
	}
	return map;
};

const extractImports = (prefix, wsdlText) => {
	const tag = elementName(prefix, 'import');
	const pat = new RegExp('<' + escapeRegex(tag) + '\\b[^>]*?/>', 'g');
	const results = [];
	let m;
	while ((m = pat.exec(wsdlText)) !== null) {
		const ns = m[0].match(/namespace="([^"]+)"/);
		const loc = m[0].match(/\blocation\s*=\s*"([^"]+)"/) || m[0].match(/\bschemaLocation\s*=\s*"([^"]+)"/);
		results.push({
			namespace: ns ? ns[1] : '',
			location: loc ? loc[1] : ''
		});
	}
	return results;
};

// Generic named-block extractor (mirrors xsdParser's pattern)
const extractNamedBlocks = (wsdlText, prefix, tagName) => {
	const tag = elementName(prefix, tagName);
	const results = [];
	const openPattern = new RegExp(
		'<' + escapeRegex(tag) + '\\b[^>]*?\\bname\\s*=\\s*"([^"]+)"[^>]*?(/?>)',
		'g'
	);
	let openMatch;
	while ((openMatch = openPattern.exec(wsdlText)) !== null) {
		const name = openMatch[1];
		const isSelfClose = openMatch[2] === '/>';
		const startIdx = openMatch.index;

		if (isSelfClose) {
			results.push({ name, body: '', fullMatch: openMatch[0] });
			continue;
		}

		const openTag = '<' + tag;
		const closeTag = '</' + tag + '>';
		let depth = 1;
		let searchStart = startIdx + openMatch[0].length;
		let endIdx = -1;

		while (depth > 0 && searchStart < wsdlText.length) {
			const nextOpen = wsdlText.indexOf(openTag, searchStart);
			const nextClose = wsdlText.indexOf(closeTag, searchStart);
			if (nextClose === -1) { break; }
			if (nextOpen !== -1 && nextOpen < nextClose) {
				const charAfter = wsdlText[nextOpen + openTag.length];
				if (charAfter === ' ' || charAfter === '\t' || charAfter === '\n' || charAfter === '>') {
					depth++;
				}
				searchStart = nextOpen + openTag.length;
			} else {
				depth--;
				if (depth === 0) {
					endIdx = nextClose + closeTag.length;
				}
				searchStart = nextClose + closeTag.length;
			}
		}

		if (endIdx !== -1) {
			const body = wsdlText.substring(startIdx + openMatch[0].length, endIdx - closeTag.length);
			results.push({ name, body, fullMatch: wsdlText.substring(startIdx, endIdx) });
		}
	}
	return results;
};

const extractFirstDocumentation = (prefix, body) => {
	const tag = elementName(prefix, 'documentation');
	const pat = new RegExp('<' + escapeRegex(tag) + '[^>]*>([\\s\\S]*?)</' + escapeRegex(tag) + '>');
	const m = body.match(pat);
	if (!m) { return ''; }
	return m[1].replace(/\s+/g, ' ').trim();
};

// ============================================================
// Messages
// ============================================================

const extractParts = (prefix, body) => {
	const tag = elementName(prefix, 'part');
	const pat = new RegExp('<' + escapeRegex(tag) + '\\b([^>]*?)/?>', 'g');
	const out = [];
	let m;
	while ((m = pat.exec(body)) !== null) {
		const attrs = m[1];
		const nameMatch = attrs.match(/\bname\s*=\s*"([^"]+)"/);
		const elementMatch = attrs.match(/\belement\s*=\s*"([^"]+)"/);
		const typeMatch = attrs.match(/\btype\s*=\s*"([^"]+)"/);
		if (!nameMatch) { continue; }
		out.push({
			name: nameMatch[1],
			element: elementMatch ? elementMatch[1] : null,
			type: typeMatch ? typeMatch[1] : null
		});
	}
	return out;
};

const parseMessages = (prefix, wsdlText) =>
	extractNamedBlocks(wsdlText, prefix, 'message').map((b) => ({
		name: b.name,
		parts: extractParts(prefix, b.body),
		documentation: extractFirstDocumentation(prefix, b.body)
	}));

// ============================================================
// PortTypes
// ============================================================
//
// portType contains operations which contain input/output/fault refs to messages.

const extractOperationsForPortType = (prefix, body) => {
	const opBlocks = extractNamedBlocks(body, prefix, 'operation');
	return opBlocks.map((op) => {
		const inputTag = elementName(prefix, 'input');
		const outputTag = elementName(prefix, 'output');
		const faultTag = elementName(prefix, 'fault');

		const inMatch = op.body.match(new RegExp('<' + escapeRegex(inputTag) + '\\b[^>]*?\\bmessage\\s*=\\s*"([^"]+)"'));
		const outMatch = op.body.match(new RegExp('<' + escapeRegex(outputTag) + '\\b[^>]*?\\bmessage\\s*=\\s*"([^"]+)"'));

		// faults can repeat
		const faults = [];
		const faultPat = new RegExp('<' + escapeRegex(faultTag) + '\\b[^>]*?\\bname\\s*=\\s*"([^"]+)"[^>]*?\\bmessage\\s*=\\s*"([^"]+)"', 'g');
		let fm;
		while ((fm = faultPat.exec(op.body)) !== null) {
			faults.push({ name: fm[1], message: fm[2] });
		}

		return {
			name: op.name,
			input: inMatch ? inMatch[1] : null,
			output: outMatch ? outMatch[1] : null,
			faults,
			documentation: extractFirstDocumentation(prefix, op.body)
		};
	});
};

const parsePortTypes = (prefix, wsdlText) =>
	extractNamedBlocks(wsdlText, prefix, 'portType').map((b) => ({
		name: b.name,
		operations: extractOperationsForPortType(prefix, b.body),
		documentation: extractFirstDocumentation(prefix, b.body)
	}));

// ============================================================
// Bindings
// ============================================================

const extractSoapDetails = (body) => {
	// soap:binding transport+style
	const styleMatch = body.match(/<soap:binding\b[^>]*?\bstyle\s*=\s*"([^"]+)"/);
	const transportMatch = body.match(/<soap:binding\b[^>]*?\btransport\s*=\s*"([^"]+)"/);
	const sb = [styleMatch, transportMatch];
	const style = styleMatch ? styleMatch[1] : '';
	const transport = transportMatch ? transportMatch[1] : '';
	return { style, transport };
};

const extractBindingOperations = (prefix, body) => {
	const opBlocks = extractNamedBlocks(body, prefix, 'operation');
	return opBlocks.map((op) => {
		const saMatch = op.body.match(/<soap:operation\b[^>]*?\bsoapAction\s*=\s*"([^"]*)"/);
		return {
			name: op.name,
			soapAction: saMatch ? saMatch[1] : null
		};
	});
};

const parseBindings = (prefix, wsdlText) =>
	extractNamedBlocks(wsdlText, prefix, 'binding').map((b) => {
		const openTag = b.fullMatch.substring(0, b.fullMatch.indexOf('>') + 1);
		const typeMatch = openTag.match(/\btype\s*=\s*"([^"]+)"/);
		const { style, transport } = extractSoapDetails(b.body);
		return {
			name: b.name,
			type: typeMatch ? typeMatch[1] : null,
			style,
			transport,
			operations: extractBindingOperations(prefix, b.body),
			documentation: extractFirstDocumentation(prefix, b.body)
		};
	});

// ============================================================
// Services
// ============================================================

const extractPorts = (prefix, body) => {
	const portBlocks = extractNamedBlocks(body, prefix, 'port');
	return portBlocks.map((p) => {
		const openTag = p.fullMatch.substring(0, p.fullMatch.indexOf('>') + 1);
		const bMatch = openTag.match(/\bbinding\s*=\s*"([^"]+)"/);
		const locMatch = p.body.match(/<soap:address\b[^>]*?\blocation\s*=\s*"([^"]+)"/);
		return {
			name: p.name,
			binding: bMatch ? bMatch[1] : null,
			location: locMatch ? locMatch[1] : null
		};
	});
};

const parseServices = (prefix, wsdlText) =>
	extractNamedBlocks(wsdlText, prefix, 'service').map((b) => ({
		name: b.name,
		ports: extractPorts(prefix, b.body),
		documentation: extractFirstDocumentation(prefix, b.body)
	}));

// ============================================================
// MAIN: parseWsdl
// ============================================================

const parseWsdl = (wsdlText, options = {}) => {
	wsdlText = normalizeLineEndings(wsdlText);

	const prefix = detectPrefix(wsdlText);
	const targetNamespace = extractTargetNamespace(wsdlText);
	const namespaceMap = buildNamespaceMap(wsdlText);
	const imports = extractImports(prefix, wsdlText);
	const messages = parseMessages(prefix, wsdlText);
	const portTypes = parsePortTypes(prefix, wsdlText);
	const bindings = parseBindings(prefix, wsdlText);
	const services = parseServices(prefix, wsdlText);

	return {
		prefix,
		targetNamespace,
		namespaceMap,
		imports,
		messages,
		portTypes,
		bindings,
		services
	};
};

module.exports = {
	parseWsdl,
	detectPrefix,
	extractTargetNamespace,
	buildNamespaceMap,
	extractImports,
	parseMessages,
	parsePortTypes,
	parseBindings,
	parseServices
};
