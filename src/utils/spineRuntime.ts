import * as spine42 from "@esotericsoftware/spine-player";

export type SpineRuntime = typeof spine42;

// The bundled 4.1 player still serves the legacy asset library.
declare const spine: SpineRuntime;

export function readSpineVersion(data: ArrayBuffer, json: boolean): string | undefined {
	const bytes = new Uint8Array(data);
	if (json) return parseSpineJson(data).skeleton?.spine;

	// Spine 4.x writes an eight-byte hash before the length-prefixed version.
	const length = (bytes[8] ?? 0) - 1;
	if (length < 3 || length > 20 || bytes.length < 9 + length)
		throw new Error("Missing Spine binary version");
	return new TextDecoder().decode(bytes.subarray(9, 9 + length));
}

function decodeJson(data: ArrayBuffer) {
	const bytes = new Uint8Array(data, 0, Math.min(2, data.byteLength));
	if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(data);
	if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(data);
	return new TextDecoder().decode(data);
}

function parseSpineJson(data: ArrayBuffer) {
	return JSON.parse(decodeJson(data));
}

export async function readSpineSource(path: string, raw?: Record<string, string>) {
	const response = await fetch(raw?.[path] ?? path);
	if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}: ${path}`);
	const bytes = await response.arrayBuffer();
	const json = /\.json(?:[?#]|$)/i.test(path);
	const version = readSpineVersion(bytes, json);
	if (version && !/^4\.[12](?:\.|$)/.test(version)) {
		throw new Error(`Unsupported Spine version ${version}. Preview supports Spine 4.1 and 4.2.`);
	}
	const runtime = version?.startsWith("4.2") ? spine42 : spine;
	return { runtime, bytes, json, version };
}

export function spineSourceUrl(source: Awaited<ReturnType<typeof readSpineSource>>) {
	const blob = source.json
		? new Blob([decodeJson(source.bytes)], { type: "application/json;charset=utf-8" })
		: new Blob([source.bytes], { type: "application/octet-stream" });
	const url = URL.createObjectURL(blob);
	// The 4.2 player chooses the JSON or binary reader from the end of its URL.
	return { url: `${url}#skeleton.${source.json ? "json" : "skel"}`, release: () => URL.revokeObjectURL(url) };
}

export async function loadSpineSkeleton(
	path: string,
	atlas: string,
	context: any,
	raw?: Record<string, string>,
	scale = 1,
	expectedRuntime?: SpineRuntime,
) {
	const { runtime, bytes, json, version } = await readSpineSource(path, raw);
	if (expectedRuntime && runtime !== expectedRuntime)
		throw new Error(`Dating pose ${path} uses Spine ${version}, which differs from its main skeleton.`);
	const manager = new runtime.AssetManager(context);
	try {
		for (const [name, data] of Object.entries(raw ?? {})) {
			manager.setRawDataURI(name, atlasDataUri(name, data, runtime));
		}
		manager.loadTextureAtlas(atlas);
		await manager.loadAll();
		const loader = new runtime.AtlasAttachmentLoader(manager.get(atlas));
		const reader = json ? new runtime.SkeletonJson(loader) : new runtime.SkeletonBinary(loader);
		reader.scale = scale;
		const data = reader.readSkeletonData(json ? parseSpineJson(bytes) : new Uint8Array(bytes));
		return { runtime, manager, data };
	} catch (error) {
		manager.dispose();
		throw error;
	}
}

export function atlasDataUri(path: string, data: string, runtime: SpineRuntime) {
	if (runtime !== spine42 || !/\.atlas$/i.test(path)) return data;
	// Use the browser's UTF-8 decoder for embedded atlas text.
	return data.replace(/^data:[^,]*;base64,/, "data:text/plain;charset=utf-8;v=4.2;base64,");
}

export function updateSpinePose(skeleton: any) {
	// Spine 4.1 ignores the extra argument. 4.2 reapplies the current physics pose.
	skeleton.updateWorldTransform(spine42.Physics.pose);
}
