'use strict';

// deterministic-zip.js — one zip archive from a list of in-memory entries, the same bytes every time for the same
// entries (the standard downloads, WORKORDER-standardDownloads-101526 §3a "Deterministic").
//
//   buildZipBuffer({ zipEntryList: [{ entryPath, contentBuffer }] }) -> { zipBuffer } | { error }
//
// What makes it deterministic, each fixed rather than read from the machine:
//   - entries are written in byte order of entryPath, whatever order they were given in;
//   - every entry carries the same DOS timestamp, 1980-01-01 00:00 (the earliest a zip can express);
//   - permissions are written as a plain file, 0644, never the source file's mode;
//   - no extra fields, no comments, no data descriptors;
//   - DEFLATE at level 9 through Node's zlib, or STORE when deflating would not make the entry smaller.
// The one dependency on the machine is the zlib library itself: a different zlib could compress differently.
//
// Refuses by name: an empty list, a non-Buffer content, a duplicate path, and an entryPath that is absolute, holds a
// backslash, an empty segment, or a '.' or '..' segment (so an archive can never write outside the directory it is
// unpacked into). Pure and synchronous: it touches no file.

const zlib = require('zlib');

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP_VERSION = 20; // 2.0: deflate, folders
const MADE_BY_UNIX = (3 << 8) | ZIP_VERSION;
const UTF8_NAME_FLAG = 0x0800;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
const FIXED_DOS_TIME = 0; // 00:00:00
const FIXED_DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01
const PLAIN_FILE_EXTERNAL_ATTRIBUTES = (0o100644 << 16) >>> 0;
const ZIP32_LIMIT = 0xffffffff;
const ENTRY_COUNT_LIMIT = 0xffff;

const entryPathFault = (entryPath) => {
	if (typeof entryPath !== 'string' || entryPath === '') {
		return 'an entryPath must be a non-empty string';
	}
	if (entryPath.startsWith('/') || entryPath.includes('\\')) {
		return `entryPath '${entryPath}' is absolute or holds a backslash; entries are relative paths with '/' separators`;
	}
	const badSegmentList = entryPath.split('/').filter((oneSegment) => oneSegment === '' || oneSegment === '.' || oneSegment === '..');
	if (badSegmentList.length) {
		return `entryPath '${entryPath}' holds an empty, '.' or '..' segment`;
	}
	return '';
};

const compressedFormOf = (contentBuffer) => {
	const deflatedBuffer = zlib.deflateRawSync(contentBuffer, { level: 9 });
	return deflatedBuffer.length < contentBuffer.length
		? { compressionMethod: METHOD_DEFLATE, storedBuffer: deflatedBuffer }
		: { compressionMethod: METHOD_STORE, storedBuffer: contentBuffer };
};

const localHeaderOf = ({ nameBuffer, compressionMethod, crc32Value, storedSize, contentSize }) => {
	const headerBuffer = Buffer.alloc(30);
	headerBuffer.writeUInt32LE(LOCAL_FILE_HEADER_SIGNATURE, 0);
	headerBuffer.writeUInt16LE(ZIP_VERSION, 4);
	headerBuffer.writeUInt16LE(UTF8_NAME_FLAG, 6);
	headerBuffer.writeUInt16LE(compressionMethod, 8);
	headerBuffer.writeUInt16LE(FIXED_DOS_TIME, 10);
	headerBuffer.writeUInt16LE(FIXED_DOS_DATE, 12);
	headerBuffer.writeUInt32LE(crc32Value, 14);
	headerBuffer.writeUInt32LE(storedSize, 18);
	headerBuffer.writeUInt32LE(contentSize, 22);
	headerBuffer.writeUInt16LE(nameBuffer.length, 26);
	headerBuffer.writeUInt16LE(0, 28);
	return Buffer.concat([headerBuffer, nameBuffer]);
};

const centralRecordOf = ({ nameBuffer, compressionMethod, crc32Value, storedSize, contentSize, localHeaderOffset }) => {
	const recordBuffer = Buffer.alloc(46);
	recordBuffer.writeUInt32LE(CENTRAL_DIRECTORY_SIGNATURE, 0);
	recordBuffer.writeUInt16LE(MADE_BY_UNIX, 4);
	recordBuffer.writeUInt16LE(ZIP_VERSION, 6);
	recordBuffer.writeUInt16LE(UTF8_NAME_FLAG, 8);
	recordBuffer.writeUInt16LE(compressionMethod, 10);
	recordBuffer.writeUInt16LE(FIXED_DOS_TIME, 12);
	recordBuffer.writeUInt16LE(FIXED_DOS_DATE, 14);
	recordBuffer.writeUInt32LE(crc32Value, 16);
	recordBuffer.writeUInt32LE(storedSize, 20);
	recordBuffer.writeUInt32LE(contentSize, 24);
	recordBuffer.writeUInt16LE(nameBuffer.length, 28);
	recordBuffer.writeUInt16LE(0, 30); // extra field length
	recordBuffer.writeUInt16LE(0, 32); // comment length
	recordBuffer.writeUInt16LE(0, 34); // disk number
	recordBuffer.writeUInt16LE(0, 36); // internal attributes
	recordBuffer.writeUInt32LE(PLAIN_FILE_EXTERNAL_ATTRIBUTES, 38);
	recordBuffer.writeUInt32LE(localHeaderOffset, 42);
	return Buffer.concat([recordBuffer, nameBuffer]);
};

const endRecordOf = ({ entryCount, centralDirectorySize, centralDirectoryOffset }) => {
	const endBuffer = Buffer.alloc(22);
	endBuffer.writeUInt32LE(END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0);
	endBuffer.writeUInt16LE(0, 4);
	endBuffer.writeUInt16LE(0, 6);
	endBuffer.writeUInt16LE(entryCount, 8);
	endBuffer.writeUInt16LE(entryCount, 10);
	endBuffer.writeUInt32LE(centralDirectorySize, 12);
	endBuffer.writeUInt32LE(centralDirectoryOffset, 16);
	endBuffer.writeUInt16LE(0, 20);
	return endBuffer;
};

const buildZipBuffer = ({ zipEntryList } = {}) => {
	if (!Array.isArray(zipEntryList) || zipEntryList.length === 0) {
		return { error: 'deterministic-zip: zipEntryList must be a non-empty list of { entryPath, contentBuffer }; an empty archive is refused' };
	}
	if (zipEntryList.length > ENTRY_COUNT_LIMIT) {
		return { error: `deterministic-zip: ${zipEntryList.length} entries exceed the ${ENTRY_COUNT_LIMIT} a zip32 archive can hold` };
	}
	const faultList = [];
	const seenPathSet = new Set();
	zipEntryList.forEach((oneEntry) => {
		const pathFault = entryPathFault(oneEntry && oneEntry.entryPath);
		if (pathFault) {
			faultList.push(pathFault);
			return;
		}
		if (!Buffer.isBuffer(oneEntry.contentBuffer)) {
			faultList.push(`entry '${oneEntry.entryPath}' has no contentBuffer (a Buffer is required)`);
			return;
		}
		if (seenPathSet.has(oneEntry.entryPath)) {
			faultList.push(`entryPath '${oneEntry.entryPath}' appears twice`);
			return;
		}
		seenPathSet.add(oneEntry.entryPath);
	});
	if (faultList.length) {
		return { error: `deterministic-zip REFUSED: ${faultList.join('; ')}` };
	}

	const sortedEntryList = zipEntryList.slice().sort((leftEntry, rightEntry) => Buffer.compare(Buffer.from(leftEntry.entryPath, 'utf8'), Buffer.from(rightEntry.entryPath, 'utf8')));
	const localPartList = [];
	const centralPartList = [];
	let byteOffset = 0;
	for (const oneEntry of sortedEntryList) {
		const nameBuffer = Buffer.from(oneEntry.entryPath, 'utf8');
		const { compressionMethod, storedBuffer } = compressedFormOf(oneEntry.contentBuffer);
		const recordFields = {
			nameBuffer,
			compressionMethod,
			crc32Value: zlib.crc32(oneEntry.contentBuffer) >>> 0,
			storedSize: storedBuffer.length,
			contentSize: oneEntry.contentBuffer.length,
			localHeaderOffset: byteOffset,
		};
		if (recordFields.contentSize > ZIP32_LIMIT || byteOffset > ZIP32_LIMIT) {
			return { error: `deterministic-zip: entry '${oneEntry.entryPath}' passes the 4 GiB zip32 limit; zip64 is not written` };
		}
		const localHeaderBuffer = localHeaderOf(recordFields);
		localPartList.push(localHeaderBuffer, storedBuffer);
		centralPartList.push(centralRecordOf(recordFields));
		byteOffset += localHeaderBuffer.length + storedBuffer.length;
	}
	const centralDirectoryBuffer = Buffer.concat(centralPartList);
	if (byteOffset + centralDirectoryBuffer.length > ZIP32_LIMIT) {
		return { error: 'deterministic-zip: the archive passes the 4 GiB zip32 limit; zip64 is not written' };
	}
	const endBuffer = endRecordOf({ entryCount: sortedEntryList.length, centralDirectorySize: centralDirectoryBuffer.length, centralDirectoryOffset: byteOffset });
	return { zipBuffer: Buffer.concat([...localPartList, centralDirectoryBuffer, endBuffer]) };
};

module.exports = { buildZipBuffer, FIXED_DOS_DATE, FIXED_DOS_TIME };
