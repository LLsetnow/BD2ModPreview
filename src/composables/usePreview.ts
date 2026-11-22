import {
	describeLoadError,
	loadIssue,
	type LoadFailure,
	type LoadIssue,
} from "./previewErrors";
import { computed, onUnmounted, ref, Ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { invoke } from "@tauri-apps/api/core";
import { usePreviewerStore, type PreviewControl, type PreviewBackground } from "../stores/previewer";
import { useHistory } from "./useHistory";
import { useLogger } from "./useLogger";
import { useGameCutscene } from "./useGameCutscene";
import { useGameBackgroundStore } from "../stores/gameBackgrounds";
import { useIllustrationBackground } from "./useIllustrationBackground";
import { useAssetLibraryStore } from '../stores/assetLibrary';
import { spineAssetCandidates } from '../utils/assetLibraryUrls';
import { useMinigameInteractions } from "./useMinigameInteractions";
import { useDatingInteractions } from "./useDatingInteractions";
import { useStandingInteractions } from "./useStandingInteractions";
import type {
	SpineAssetsData,
	SpinePlayer,
	SpineSource,
	AnimationSequence,
	AudioAsset,
	LoadStep,
	LoadStepState,
} from "../types/spine";

import { atlasDataUri, readSpineSource, spineSourceUrl, updateSpinePose } from "../utils/spineRuntime";

export function usePreview(
	id: string,
	playerContainer: Ref<HTMLElement | null>,
) {
	const previewerStore = usePreviewerStore();
	const library = useAssetLibraryStore();

	const { logMessage } = useLogger();
	const { addToHistory } = useHistory();
	const { t, te } = useI18n();

	const cutscene = useGameCutscene(
		() => settings.value?.background.type === "game",
	);

	const gameBackgrounds = useGameBackgroundStore();
	const minigame = useMinigameInteractions();

	const datingInteraction = useDatingInteractions(
		(animation) => {
			if (!settings.value) return;
			settings.value.followGlobalAnimation = false;
			settings.value.currentAnimation = animation;
		},
		(player) => {
			if (!preview.value) return;

			preview.value.allAnimations = player.skeleton.data.animations.map(
				(animation: any) => animation.name,
			);

			layers.value = player.skeleton.data.slots.map((slot: any) => slot.name);
			skins.value = player.skeleton.data.skins.map((skin: any) => skin.name);
			skin.value = player.skeleton.data.defaultSkin?.name ?? "";
			hiddenLayers.value = [];
			highlightedLayer.value = "";
			hiddenAttachments.clear();
		},
		(message) =>
			logMessage(
				JSON.stringify({ source: source.value, error: message }),
				"error",
			),
	);
	
	const error = ref("");
	const errorInfo = ref<LoadIssue | null>(null);
	let loadResults: LoadFailure[] = [];
	const retryCount = ref(0);
	const activeSequence = ref<AnimationSequence | null>(null);
	const playbackTime = ref(0);
	const duration = ref(0);
	const layers = ref<string[]>([]);
	const highlightedLayer = ref("");
	const hiddenLayers = ref<string[]>([]);
	const skins = ref<string[]>([]);
	const skin = ref("");
	const hiddenAttachments = new Map<any, any>();
	let loadId = 0;
	let playbackChoice = 0;
	let spinePlayer: SpinePlayer | null = null;
	let releaseSkeletonUrl: (() => void) | undefined;
	let audioStateListener: any = null;
	let activeAudio: HTMLAudioElement | null = null;
	let audioPlaybackToken = 0;
	let sequenceAudioStep = -1;
	let isManualSequenceAudio = false;
	const audioDataCache = new Map<string, string>();
	const loadSteps = ref<LoadStep[]>([]);
	let frameRequest: ((frame: HTMLCanvasElement) => void) | null = null;
	let previousCamera: typeof camera = null;
	let camera: { x: number; y: number; zoom: number } | null = null;
	let initialCamera: { x: number; y: number; zoom: number } | null = null;
	let defaultZoom = 1;
	let cameraListeners: AbortController | null = null;
	const preview = computed(() => previewerStore.getPreview(id));
	const isLoading = computed(() => preview.value?.isLoading ?? false);
	const title = computed(() => preview.value?.title ?? "");
	const source = computed(() => preview.value?.source ?? null);
	const settings = computed(() => preview.value?.settings ?? null);
	const illustrationBackground = useIllustrationBackground(
		computed<PreviewBackground | null>({
			get: () => settings.value?.background ?? null,
			set: (value) => { if (settings.value && value) settings.value.background = value; },
		}),
		() => gameBackgrounds.showIllustrationByDefault,
		(message) => logMessage(message, "warning"),
	);
	const backgroundImagePath = computed(() => {
		const background = settings.value?.background;
		return background?.type === "image" ? background.path
			: background?.type === "illustration" ? illustrationBackground.image.value : "";
	});

	const standing = useStandingInteractions({
		canInteract: () => !activeSequence.value && !cutscene.active.value && !datingInteraction.enabled.value && !minigame.enabled.value,
		isPaused: () => settings.value?.paused ?? false,
		isSlotVisible: (name) => !hiddenLayers.value.includes(name),
		beforePlay: () => {
			stopActiveAudio();
			if (settings.value) { settings.value.paused = false; settings.value.followGlobalAnimation = false; }
		},
	});

	watch(
		() => cutscene.backgroundInfo.value,
		(info) => {
			if (preview.value) preview.value.gameBackground = info;
		},
	);

	const currentAnimation = computed(
		() => preview.value?.settings.currentAnimation ?? null,
	);

	const allAnimations = computed(() => preview.value?.allAnimations ?? []);

	const paused = computed({
		get: () => settings.value?.paused ?? false,
		set: (value: boolean) => runControl({ type: "pause", value }),
	});

	const animationSelection = computed({
		get: () =>
			settings.value?.followGlobalAnimation
				? ""
				: (currentAnimation.value ?? ""),
		set: (value: string) => runControl({ type: "animation", value }),
	});

	const loopAnimation = computed({
		get: () => settings.value?.loopAnimation ?? true,
		set: (value: boolean) => runControl({ type: "loop", value }),
	});

	function runControl(control: PreviewControl) {
		applyControl(control);
		previewerStore.broadcastControl(id, control);
	}

	function applyControl(control: PreviewControl) {
		if (!spinePlayer || !settings.value) return;
		if (["animation", "sequence", "cutscene"].includes(control.type)) playbackChoice++;

		switch (control.type) {
			case "pause":
				settings.value.paused = control.value;
				break;
			case "loop":
				settings.value.loopAnimation = control.value;
				break;
			case "animation": {
				if (datingInteraction.enabled.value || minigame.enabled.value) return;
				const animation =
					control.value ||
					previewerStore.globalAnimation ||
					allAnimations.value[0];
				if (!allAnimations.value.includes(animation)) return;
				standing.cancelMotion();
				stopGameCutscene();
				stopSequence();
				settings.value.followGlobalAnimation = control.value === "";
				settings.value.currentAnimation = animation;
				restart();
				break;
			}
			case "seek":
				seekTo(control.time);
				break;
			case "restart":
				restart();
				break;
			case "fit":
				fitCharacter();
				break;
			case "center":
				centerCharacter();
				break;
			case "resetCamera":
				resetCamera();
				break;
			case "cutscene":
				playGameCutscene();
				break;
			case "stopSequence":
				stopSequence();
				break;
			case "sequence":
				if (
					control.sequence.steps.every((step) =>
						step.every((entry) =>
							allAnimations.value.includes(entry.animation),
						),
					)
				)
					playSequence(control.sequence);
				break;
		}
	}

	const sequenceKey = computed(() => {
		const value = source.value;

		if (!value) return "";

		return value.type === "folder"
			? "folder:" +
					value.path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()
			: "url:" + JSON.stringify([value.skeletonUrl, value.atlasUrl]);
	});

	const sequences = computed(
		() => previewerStore.savedSequences[sequenceKey.value] ?? [],
	);

	// World units per pixel. Without the game background the whole 1600-unit square is shown. With it, the
	// game's own framing is used: its canvas scaler is "Expand" with a 1600x720 landscape reference, so the
	// canvas is at least 1600 wide and 720 tall, which is why 16:9 backgrounds fill the frame in the game.
	function gameCutsceneZoom(player: SpinePlayer) {
		const width = player.canvas.clientWidth;
		const height = player.canvas.clientHeight;

		if (settings.value?.background.type === "game")
			return Math.max(1600 / width, 720 / height);

		return 1600 / Math.min(width, height);
	}

	function playGameCutscene(startPaused = false) {
		standing.stop();
		if (!spinePlayer || !settings.value || !cutscene.available.value) return;
		stopSequence();
		stopActiveAudio();
		isManualSequenceAudio = false;
		datingInteraction.enabled.value = false;
		minigame.enabled.value = false;
		if (!cutscene.active.value) previousCamera = camera ? { ...camera } : null;
		camera = { x: 0, y: 0, zoom: gameCutsceneZoom(spinePlayer) };
		settings.value.followGlobalAnimation = false;
		cutscene.start();
		playbackTime.value = 0;
		duration.value = cutscene.duration;
		settings.value!.paused = startPaused;
		if (startPaused) cutscene.setPaused(true);
		offerGameBackground();
	}

	const gameImage = ref({ hash: "", uri: "" });
	const loadingGameImage = ref("");

	async function selectGameBackgroundImage(hash: string) {
		if (!settings.value || loadingGameImage.value) return;
		loadingGameImage.value = hash;

		try {
			const uri = await gameBackgrounds.load(hash);

			if (!settings.value) return;
			gameImage.value = { hash, uri };
			settings.value.background = { type: "image", path: uri };
		} catch (error) {
			logMessage(
				`Game background image ${hash.slice(0, 8)} failed: ${error}`,
				"warning",
			);
		} finally {
			loadingGameImage.value = "";
		}
	}

	function isGameBackgroundImageSelected(hash: string) {
		const background = settings.value?.background;

		return (
			background?.type === "image" &&
			gameImage.value.hash === hash &&
			background.path === gameImage.value.uri
		);
	}

	function offerGameBackground() {
		const info = cutscene.backgroundInfo.value;

		if (!info || settings.value?.background.type !== "theme") return;

		gameBackgrounds.offer(
			`${id}:${cutscene.cutsceneId.value}`,
			cutscene.backgroundImages.value.map((image) => image.hash),
			info.bytes,
			() => {
				if (settings.value?.background.type === "theme")
					settings.value.background = { type: "game" };
			},
		);
	}

	watch(
		() => settings.value?.background.type === "game",
		() => {
			if (cutscene.active.value && camera && spinePlayer)
				camera = { x: 0, y: 0, zoom: gameCutsceneZoom(spinePlayer) };
		},
	);

	function stopGameCutscene() {
		if (!cutscene.active.value) return;
		cutscene.stop();
		camera = previousCamera;
		previousCamera = null;
	}

	function normalizeAudioKey(value: string): string {
		return value
			.replace(/\\/g, "/")
			.replace(/^\.\//, "")
			.replace(/^audio\//i, "")
			.replace(/\.[^./]+$/i, "")
			.toLowerCase();
	}

	function findAudioAsset(
		candidates: Array<string | null | undefined>,
	): AudioAsset | undefined {
		const keys = candidates
			.filter((candidate): candidate is string => Boolean(candidate?.trim()))
			.map((candidate) => normalizeAudioKey(candidate.trim()));
		const basenames = keys.map((key) => key.split("/").pop() || key);

		for (const asset of settings.value?.audioAssets ?? []) {
			const relativeKey = normalizeAudioKey(asset.relativePath);
			const fileKey = normalizeAudioKey(asset.fileName);
			if (keys.includes(relativeKey) || basenames.includes(fileKey)) return asset;
		}
		return undefined;
	}

	function stopActiveAudio() {
		audioPlaybackToken += 1;
		if (!activeAudio) return;
		activeAudio.pause();
		activeAudio.currentTime = 0;
		activeAudio = null;
	}

	async function playAudioAsset(relativePath: string) {
		const folderPath = settings.value?.audioFolder;
		if (!folderPath) return;

		const cacheKey = `${folderPath}\\${relativePath}`;
		const requestToken = ++audioPlaybackToken;

		try {
			let audioUrl = audioDataCache.get(cacheKey);
			if (!audioUrl) {
				audioUrl = await invoke<string>("read_audio_file", {
					folderPath,
					relativePath,
				});
				audioDataCache.set(cacheKey, audioUrl);
			}

			if (requestToken !== audioPlaybackToken) return;
			if (activeAudio) {
				activeAudio.pause();
				activeAudio.currentTime = 0;
			}

			const audio = new Audio(audioUrl);
			audio.preload = "auto";
			audio.onended = () => {
				if (activeAudio === audio) activeAudio = null;
			};
			activeAudio = audio;
			await audio.play();
		} catch (error) {
			logMessage(`Could not play audio '${relativePath}': ${String(error)}`, "warning");
		}
	}

	function installAudioListener(player: SpinePlayer) {
		if (!player.animationState?.addListener) return;

		audioStateListener = {
			start: (entry: any) => {
				if (isManualSequenceAudio || standing.ownsPlayback.value || cutscene.active.value) return;
				const asset = findAudioAsset([entry?.animation?.name]);
				if (asset) void playAudioAsset(asset.relativePath);
			},
			event: (_entry: any, event: any) => {
				if (isManualSequenceAudio || standing.ownsPlayback.value || cutscene.active.value) return;
				const eventData = event?.data;
				const asset = findAudioAsset([
					eventData?.audioPath,
					event?.stringValue,
					eventData?.stringValue,
					eventData?.name,
				]);
				if (asset) void playAudioAsset(asset.relativePath);
			},
		};
		player.animationState.addListener(audioStateListener);
	}

	function playSequence(sequence: AnimationSequence) {
		standing.stop();
		if (!spinePlayer || !settings.value) return;
		stopActiveAudio();
		const selectedAudio = settings.value.sequenceAudioPath
			? settings.value.audioAssets.find(
					(asset) => asset.relativePath === settings.value?.sequenceAudioPath,
				)
			: undefined;
		isManualSequenceAudio = Boolean(selectedAudio);
		sequenceAudioStep = -1;
		datingInteraction.enabled.value = false;
		minigame.enabled.value = false;
		stopGameCutscene();
		activeSequence.value = sequence;
		settings.value.followGlobalAnimation = false;
		spinePlayer.animationState.clearTracks();
		playbackTime.value = 0;
		if (selectedAudio) void playAudioAsset(selectedAudio.relativePath);
		applySequence(0);
		settings.value!.paused = false;
		spinePlayer.play();
	}

	function stopSequence() {
		if (!activeSequence.value) return;
		activeSequence.value = null;
		sequenceAudioStep = -1;
		isManualSequenceAudio = false;
		stopActiveAudio();

		if (spinePlayer && currentAnimation.value) {
			spinePlayer.setAnimation(
				currentAnimation.value,
				settings.value?.loopAnimation ?? true,
			);

			applyPose();
		}
	}

	function applySequence(time: number) {
		if (!spinePlayer || !activeSequence.value) return;

		const skeleton = spinePlayer.skeleton;

		const steps = activeSequence.value.steps.map((step) =>
			step.map((entry) => ({
				...entry,
				animation: skeleton.data.findAnimation(entry.animation),
			})),
		);

		const lengths = steps.map((step) =>
			Math.max(
				0,
				...step.map(
					(entry) =>
						entry.delay + (entry.duration ?? entry.animation?.duration ?? 0),
				),
			),
		);

		duration.value = lengths.reduce((total, length) => total + length, 0);

		const position =
			settings.value?.loopAnimation && duration.value > 0
				? time % duration.value
				: Math.min(time, duration.value);
		playbackTime.value = position;

		let start = 0;
		let index = 0;

		while (index < steps.length - 1 && position >= start + lengths[index]) {
			start += lengths[index++];
		}

		const sequenceLooped =
			!!settings.value?.loopAnimation &&
			time > 0 &&
			position < playbackTime.value;
		if (sequenceLooped) sequenceAudioStep = -1;
		if (index !== sequenceAudioStep) {
			sequenceAudioStep = index;
			if (isManualSequenceAudio) {
				if (sequenceLooped && settings.value?.sequenceAudioPath)
					void playAudioAsset(settings.value.sequenceAudioPath);
			} else {
				stopActiveAudio();
				const animationNames = (activeSequence.value.steps[index] ?? []).map(
					(entry) => entry.animation,
				);
				const asset = findAudioAsset(animationNames);
				if (asset) void playAudioAsset(asset.relativePath);
			}
		}

		skeleton.setToSetupPose();

		for (const entry of steps[index] ?? []) {
			if (!entry.animation || position - start < entry.delay) continue;

			const elapsed = Math.min(
				position - start - entry.delay,
				entry.duration ?? entry.animation.duration,
			);

			entry.animation.apply(
				skeleton,
				-1,
				entry.loop ? elapsed : Math.min(elapsed, entry.animation.duration),
				!!entry.loop,
				null,
				1,
				spinePlayer.spineRuntime.MixBlend.replace,
				spinePlayer.spineRuntime.MixDirection.mixIn,
			);
		}

		updateSpinePose(skeleton);
	}

	// Skeleton bounds without huge backdrop meshes (dating illusts have one), which would zoom the camera way out.
	function characterBounds(offset: any, size: any) {
		const rects: number[][] = [];
		const spine = spinePlayer!.spineRuntime;

		for (const slot of spinePlayer!.skeleton.drawOrder) {
			const attachment = slot.attachment;
			const vertices: number[] = [];

			if (attachment instanceof spine.RegionAttachment)
				attachment.computeWorldVertices(slot, vertices, 0, 2);
			else if (attachment instanceof spine.MeshAttachment)
				attachment.computeWorldVertices(
					slot,
					0,
					attachment.worldVerticesLength,
					vertices,
					0,
					2,
				);
			else continue;

			const xs = vertices.filter((_, i) => i % 2 === 0);
			const ys = vertices.filter((_, i) => i % 2 === 1);

			rects.push([
				Math.min(...xs),
				Math.min(...ys),
				Math.max(...xs),
				Math.max(...ys),
			]);
		}

		const extent = ([x0, y0, x1, y1]: number[]) => Math.max(x1 - x0, y1 - y0);

		const median = rects.map(extent).sort((a, b) => a - b)[
			Math.floor(rects.length / 2)
		];

		const kept = rects.filter((rect) => extent(rect) <= median * 20);
		const left = Math.min(...kept.map((r) => r[0]));
		const bottom = Math.min(...kept.map((r) => r[1]));

		offset.set(left, bottom);

		size.set(
			Math.max(...kept.map((r) => r[2])) - left,
			Math.max(...kept.map((r) => r[3])) - bottom,
		);
	}

	function fitCharacter() {
		if (!spinePlayer) return;

		const offset = new spinePlayer.spineRuntime.Vector2();
		const size = new spinePlayer.spineRuntime.Vector2();

		characterBounds(offset, size);

		const canvas = spinePlayer.canvas;

		if (!canvas.clientWidth || !canvas.clientHeight || !size.x || !size.y)
			return;
		defaultZoom =
			Math.max(size.x / canvas.clientWidth, size.y / canvas.clientHeight) * 1.2;

		camera = {
			x: offset.x + size.x / 2,
			y: offset.y + size.y / 2,
			zoom: defaultZoom,
		};

		if (!initialCamera) initialCamera = { ...camera };
	}

	function centerCharacter() {
		if (!spinePlayer || !camera) return;

		const offset = new spinePlayer.spineRuntime.Vector2();
		const size = new spinePlayer.spineRuntime.Vector2();

		characterBounds(offset, size);
		camera.x = offset.x + size.x / 2;
		camera.y = offset.y + size.y / 2;
	}

	function resetCamera() {
		if (initialCamera) {
			camera = { ...initialCamera };
			defaultZoom = initialCamera.zoom;
		}
	}

	function setupCamera(player: SpinePlayer) {
		fitCharacter();

		const canvas = player.canvas;

		cameraListeners = new AbortController();

		const { signal } = cameraListeners;
		let drag: { id: number; x: number; y: number; startX: number; startY: number; click: boolean; moved: boolean } | null = null;

		canvas.style.touchAction = "none";
		window.addEventListener("blur", () => { minigame.cancel(); drag = null; standing.stopAudio(); }, { signal });

		canvas.addEventListener(
			"pointerdown",
			(event) => {
				if (event.button !== 0 && event.button !== 1) return;

				if (
					!activeSequence.value &&
					(minigame.pointerDown(event) || datingInteraction.pointerDown(event))
				) {
					settings.value!.paused = false;
					player.play();

					return;
				}

				event.preventDefault();
				canvas.setPointerCapture(event.pointerId);

				drag = {
					id: event.pointerId,
					x: event.clientX,
					y: event.clientY,
					startX: event.clientX, startY: event.clientY,
					click: event.button === 0 && standing.hitTest(event), moved: false,
				};
			},
			{ signal },
		);

		canvas.addEventListener("pointerleave", datingInteraction.pointerLeave, {
			signal,
		});

		canvas.addEventListener(
			"pointermove",
			(event) => {
				if (minigame.pointerMove(event) || datingInteraction.pointerMove(event))
					return;
				if (!camera || !drag || drag.id !== event.pointerId) return;

				if (!drag.moved) {
					if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) <= 6) return;
					drag.moved = true;
				}
				const dx = event.clientX - drag.x;
				const dy = event.clientY - drag.y;

				camera.x -= dx * camera.zoom;
				camera.y += dy * camera.zoom;
				drag.x = event.clientX;
				drag.y = event.clientY;

				const width = canvas.clientWidth;
				const height = canvas.clientHeight;

				if (width && height)
					previewerStore.broadcastCameraChange(id, {
						zoomRatio: 1,
						dx: dx / width,
						dy: dy / height,
						anchorX: 0,
						anchorY: 0,
					});
			},
			{ signal },
		);

		canvas.addEventListener(
			"pointerup",
			(event) => {
				if (minigame.pointerUp(event) || datingInteraction.pointerUp(event))
					return;
				if (drag?.id !== event.pointerId) return;
				const pressed = drag;
				drag = null;
				canvas.releasePointerCapture(event.pointerId);
				if (pressed.click && !pressed.moved && Math.hypot(event.clientX - pressed.startX, event.clientY - pressed.startY) <= 6 && standing.hitTest(event)) standing.click();
			},
			{ signal },
		);

		canvas.addEventListener(
			"lostpointercapture",
			(event) => {
				datingInteraction.releaseMarker(event);
				minigame.cancel(event.pointerId);
				drag = null;
				datingInteraction.cancelHold();
				datingInteraction.cancelDrag();
			},
			{ signal },
		);

		canvas.addEventListener(
			"pointercancel",
			(event) => {
				datingInteraction.releaseMarker(event);
				minigame.cancel(event.pointerId);
				drag = null;
				datingInteraction.cancelHold();
				datingInteraction.cancelDrag();
			},
			{ signal },
		);

		canvas.addEventListener(
			"wheel",
			(event) => {
				if (!camera) return;
				event.preventDefault();

				const rect = canvas.getBoundingClientRect();
				const x = event.clientX - rect.left - rect.width / 2;
				const y = rect.height / 2 - (event.clientY - rect.top);
				const delta =
					event.deltaY *

					(event.deltaMode === 1
						? 16
						: event.deltaMode === 2
							? rect.height
							: 1);

				const zoom = Math.min(
					defaultZoom * 100,
					Math.max(defaultZoom * 0.001, camera.zoom * Math.exp(delta * 0.001)),
				);

				const oldZoom = camera.zoom;

				camera.x += x * (oldZoom - zoom);
				camera.y += y * (oldZoom - zoom);
				camera.zoom = zoom;

				if (rect.width && rect.height && oldZoom > 0 && zoom !== oldZoom) {
					previewerStore.broadcastCameraChange(id, {
						zoomRatio: zoom / oldZoom,
						dx: 0,
						dy: 0,
						anchorX: x / rect.width,
						anchorY: y / rect.height,
					});
				}
			},
			{ signal, passive: false },
		);

		canvas.addEventListener(
			"dblclick",
			() => {
				if (!datingInteraction.enabled.value && !minigame.enabled.value)
					runControl({ type: "fit" });
			},
			{ signal },
		);
	}

	function applyPose() {
		if (!spinePlayer) return;
		spinePlayer.skeleton.setToSetupPose();
		spinePlayer.animationState.apply(spinePlayer.skeleton);
		updateSpinePose(spinePlayer.skeleton);
	}

	function restart() {
		standing.stop();
		if (!spinePlayer) return;

		if (datingInteraction.enabled.value) {
			datingInteraction.restart();
			playbackTime.value = 0;

			return;
		}

		datingInteraction.reset();

		if (minigame.enabled.value) {
			minigame.reset();

			return;
		}

		if (cutscene.active.value) {
			stopActiveAudio();
			cutscene.seek(0);
			playbackTime.value = 0;

			return;
		}

		if (activeSequence.value) {
			stopActiveAudio();
			sequenceAudioStep = -1;
			const sequenceAudioPath = settings.value?.sequenceAudioPath;
			if (isManualSequenceAudio && sequenceAudioPath)
				void playAudioAsset(sequenceAudioPath);
			applySequence(0);

			return;
		}

		stopActiveAudio();
		for (const track of spinePlayer.animationState.tracks) {
			if (!track) continue;
			track.trackTime = 0;
			track.trackLast = -1;
			track.nextTrackLast = -1;
			track.animationLast = -1;
			track.nextAnimationLast = -1;
			track.mixingFrom = null;
		}

		applyPose();
		playbackTime.value = 0;
		const asset = findAudioAsset([currentAnimation.value]);
		if (asset) void playAudioAsset(asset.relativePath);
	}

	function seekTo(value: number) {
		standing.cancelMotion();
		if (!spinePlayer || !duration.value || minigame.enabled.value) return;
		datingInteraction.reset();
		settings.value!.paused = true;
		spinePlayer.pause();

		const time = Math.max(0, Math.min(value, duration.value));

		if (cutscene.active.value) {
			cutscene.seek(time);
			playbackTime.value = time;

			return;
		}

		if (activeSequence.value) {
			applySequence(time);

			return;
		}

		for (const track of spinePlayer.animationState.tracks) {
			if (!track) continue;
			track.trackTime = time;
			track.trackLast = time;
			track.nextTrackLast = time;
			track.mixingFrom = null;
		}

		applyPose();
		playbackTime.value = time;
	}

	function onPlayerUpdate(player: SpinePlayer, delta: number) {
		if (!camera) fitCharacter();
		if (activeSequence.value) applySequence(playbackTime.value + delta);

		if (camera) {
			const rendererCamera = player.sceneRenderer.camera;

			rendererCamera.position.x = camera.x;
			rendererCamera.position.y = camera.y;

			rendererCamera.zoom =
				(camera.zoom * player.canvas.clientWidth) / player.canvas.width;
			rendererCamera.update();
		}

		for (const slot of player.skeleton.slots) {
			if (hiddenLayers.value.includes(slot.data.name)) {
				hiddenAttachments.set(slot, slot.attachment);
				slot.attachment = null;
			}
		}

		if (cutscene.active.value) {
			playbackTime.value = cutscene.update(
				paused.value ? 0 : delta,
				settings.value?.loopAnimation ?? true,
			);

			duration.value = cutscene.duration;
		} else if (!activeSequence.value) {
			const track = player.animationState.getCurrent(0);

			duration.value = track?.animation.duration ?? 0;
			playbackTime.value = track?.getAnimationTime() ?? 0;
		}
	}

	function showError(reason: unknown, request: number, recorded = false) {
		if (request !== loadId) return;

		const origin = source.value?.type === "folder" ? "folder" : "online";

		if (!recorded) loadResults.push(...describeLoadError(reason, origin));
		errorInfo.value = loadIssue(origin, loadResults);

		logMessage(
			JSON.stringify({ ...errorInfo.value, source: source.value }),
			"error",
		);

		const detail = reason as { type?: string; message?: unknown };

		error.value =
			detail?.type && te("errors." + detail.type + ".message")
				? t("errors." + detail.type + ".message")
				: reason instanceof Error
					? reason.message
					: typeof reason === "string"
						? reason
						: t("preview.loadFailed");
		if (preview.value) preview.value.isLoading = false;

		logMessage(
			JSON.stringify(reason instanceof Error ? reason.message : reason),
			"error",
		);
	}

	async function loadSpineFromFolder(path: string, request: number) {
		const assets = await invoke<SpineAssetsData>("get_spine_assets", {
			folderPath: path,
		});

		if (request !== loadId) return;
		if (!assets.skeletonFilename || !assets.atlasFilename)
			throw new Error(t("preview.missingAssets"));

		const firstPart = Object.keys(assets.rawData ?? {})
			.sort()
			.find((name) => /^illust_dating\d+_1\.(skel|json)$/i.test(name));

		if (
			firstPart &&
			assets.rawData?.[firstPart.replace(/\.(skel|json)$/i, ".atlas")]
		) {
			assets.skeletonFilename = firstPart;
			assets.atlasFilename = firstPart.replace(/\.(skel|json)$/i, ".atlas");
		}

		await initializePlayer(createPlayerConfig(assets), assets, request);
	}

	async function loadSpineFromUrl(
		source: Extract<SpineSource, { type: 'url' }>,
		request: number,
	) {
		await library.ready();
		const attempts = spineAssetCandidates(source).map(({ skeletonUrl, atlasUrl }) => ({
			skeletonUrl, atlasUrl,
			assets: { skeletonFilename: library.url(skeletonUrl), atlasFilename: library.url(atlasUrl) },
		}));
		const unique = [...new Map(attempts.map(attempt => [
			JSON.stringify(attempt.assets), attempt,
		])).values()];

		async function loadCandidate(index: number): Promise<void> {
			if (request !== loadId) return;
			const { skeletonUrl, atlasUrl, assets } = unique[index]!;
			const config = createPlayerConfig(assets);

			config.error = async (_player: SpinePlayer, message: string) => {
				if (request !== loadId) return;
				loadResults.push(...describeLoadError(message, "online", skeletonUrl));
				logMessage(JSON.stringify({ results: loadResults, skeletonUrl, atlasUrl, message }), "error");
				if (index + 1 === unique.length) {
					showError(message, request, true);
					return;
				}
				try {
					await loadCandidate(index + 1);
				} catch (error) {
					showError(error, request);
				}
			};

			try {
				await initializePlayer(config, assets, request);
			} catch (error) {
				await config.error(undefined, error instanceof Error ? error.message : String(error));
			}
		}

		await loadCandidate(0);
	}

	function createPlayerConfig(assetsData: SpineAssetsData) {
		const config: any = {
			atlasUrl: assetsData.atlasFilename,
			showControls: false,
			alpha: true,
			showLoading: false,
			premultipliedAlpha: settings.value?.premultipliedAlpha,
			draw: (player: SpinePlayer) => {
				const spine = player.spineRuntime;
				for (const [slot, attachment] of hiddenAttachments)
					slot.attachment = attachment;
				hiddenAttachments.clear();

				const cutsceneDrawn = cutscene.draw();

				if (frameRequest) {
					const resolve = frameRequest;

					frameRequest = null;
					resolve(copyCanvas(player.canvas));
				}

				if (cutsceneDrawn) return;
				if (playerContainer.value)
					datingInteraction.updateMarkers(
						playerContainer.value.getBoundingClientRect(),
					);

				if (!highlightedLayer.value) return;

				const slot = player.skeleton.findSlot(highlightedLayer.value);

				if (!slot?.bone.active || !slot.attachment) return;

				const attachment = slot.attachment;
				const vertices: number[] = [];

				if (attachment instanceof spine.RegionAttachment) {
					attachment.computeWorldVertices(slot, vertices, 0, 2);
				} else if (attachment instanceof spine.MeshAttachment) {
					attachment.computeWorldVertices(
						slot,
						0,
						attachment.worldVerticesLength,
						vertices,
						0,
						2,
					);
				}

				if (!vertices.length) return;

				let left = Infinity,
					bottom = Infinity,
					right = -Infinity,
					top = -Infinity;

				for (let i = 0; i < vertices.length; i += 2) {
					left = Math.min(left, vertices[i]);
					right = Math.max(right, vertices[i]);
					bottom = Math.min(bottom, vertices[i + 1]);
					top = Math.max(top, vertices[i + 1]);
				}

				const renderer = player.sceneRenderer;
				const color = new spine.Color(1, 0.8, 0.2, 1);

				renderer.begin();
				renderer.line(left, bottom, right, bottom, color);
				renderer.line(right, bottom, right, top, color);
				renderer.line(right, top, left, top, color);
				renderer.line(left, top, left, bottom, color);
				renderer.end();
			},
		};

		config.backgroundColor =
			settings.value?.background.type === "color"
				? settings.value.background.color
				: "#00000000";

		const skeletonPath = assetsData.skeletonFilename.split(/[?#]/)[0]!.toLowerCase();
		if (skeletonPath.endsWith(".json")) {
			config.jsonUrl = assetsData.skeletonFilename;
		} else if (skeletonPath.endsWith(".skel")) {
			config.skelUrl = assetsData.skeletonFilename;
		} else {
			throw new Error(t("preview.unsupportedSkeleton"));
		}

		if (assetsData.rawData) {
			config.rawDataURIs = assetsData.rawData;
		}

		return config;
	}

	async function initializePlayer(config: any, assets: SpineAssetsData, request: number) {
		const skeletonSource = await readSpineSource(assets.skeletonFilename, assets.rawData);
		if (request !== loadId || !playerContainer.value) return;
		destroyPlayer();
		const { runtime } = skeletonSource;
		const sourceUrl = spineSourceUrl(skeletonSource);
		releaseSkeletonUrl = sourceUrl.release;
		if (skeletonSource.json) config.jsonUrl = sourceUrl.url;
		else config.skelUrl = sourceUrl.url;
		if (assets.rawData) {
			config.rawDataURIs = Object.fromEntries(Object.entries(assets.rawData)
				.map(([name, data]) => [name, atlasDataUri(name, data, runtime)]));
		}

		const onError = config.error;

		config.success = (player: SpinePlayer) => {
			sourceUrl.release();
			if (request !== loadId) return;

			logMessage(
				JSON.stringify({
					source: source.value,
					result: "Loaded",
					spineVersion: skeletonSource.version,
					skeleton: assets.skeletonFilename,
					atlas: config.atlasUrl,
				}),
				"info",
			);

			onPlayerSuccess(player);
			if (preview.value) preview.value.isLoading = false;
			if (source.value)
				addToHistory({ ...source.value }, undefined, undefined, title.value);
		};

		config.error = (player: SpinePlayer, message: string) => {
			sourceUrl.release();
			if (request !== loadId) return;
			if (onError) onError(player, message);
			else showError(message, request);
		};

		config.update = (player: SpinePlayer, delta: number) => {
			if (request === loadId) {
				datingInteraction.update(delta);
				if (!paused.value) minigame.update(delta);
				onPlayerUpdate(player, delta);
			}
		};

		playerContainer.value.innerHTML = "";
		const player = Object.assign(new runtime.SpinePlayer(playerContainer.value, config), {
			spineRuntime: runtime,
			spineAssets: assets,
		}) as unknown as SpinePlayer;

		spinePlayer = player;
		trackLoadSteps(player, config, request);
	}

	function trackLoadSteps(player: SpinePlayer, config: any, request: number) {
		const manager = (player as any).assetManager;
		const skeletonPath: string = config.skelUrl ?? config.jsonUrl;
		const atlasPath: string = config.atlasUrl;
		const baseName = (path: string) =>
			decodeURIComponent(path.split("?")[0].split(/[\\/]/).pop() ?? path);
		const texturePaths: string[] = [];
		const loadTexture = manager.loadTexture.bind(manager);
		let last = "";

		manager.loadTexture = (path: string, ...rest: unknown[]) => {
			texturePaths.push(path);

			return loadTexture(path, ...rest);
		};

		const stateOf = (path: string): LoadStepState =>
			manager.getErrors()?.[path] !== undefined
				? "error"
				: manager.get(path) !== undefined
					? "done"
					: "loading";

		const tick = () => {
			if (request !== loadId || !preview.value?.isLoading) return;

			const atlasState = stateOf(atlasPath);
			const textureStates = texturePaths.map(stateOf);
			const loaded = textureStates.filter((state) => state === "done").length;
			const textureState: LoadStepState = textureStates.includes("error")
				? "error"
				: !textureStates.length
					? "pending"
					: loaded === textureStates.length
						? "done"
						: "loading";
			const steps: LoadStep[] = [
				{
					key: skeletonPath,
					name: baseName(player.spineAssets.skeletonFilename),
					state: stateOf(skeletonPath),
				},
				{
					key: atlasPath,
					name: baseName(atlasPath),
					state:
						atlasState === "loading" && texturePaths.length ? "done" : atlasState,
				},
				{
					key: "textures",
					name: "",
					state: textureState,
					loaded,
					total: texturePaths.length,
				},
			];
			const signature = JSON.stringify(steps);

			if (signature !== last) {
				last = signature;
				loadSteps.value = steps;
			}

			requestAnimationFrame(tick);
		};

		loadSteps.value = [];
		requestAnimationFrame(tick);
	}

	// Some dating skeletons (e.g. illust_dating10) draw nothing with the default skin; their images are in the named skins.
	function pickVisibleSkin(player: SpinePlayer) {
		const spine = player.spineRuntime;
		const skeleton = player.skeleton;

		const drawsImages = () => {
			skeleton.setToSetupPose();
			player.animationState.apply(skeleton);
			updateSpinePose(skeleton);

			return skeleton.drawOrder.some(
				(slot: any) =>
					slot.color.a > 0 &&
					(slot.attachment instanceof spine.RegionAttachment ||
						slot.attachment instanceof spine.MeshAttachment),
			);
		};

		const original = skeleton.skin;

		if (drawsImages()) return;

		const visible = skeleton.data.skins.find((candidate: any) => {
			skeleton.setSkin(candidate);

			return drawsImages();
		});

		if (visible) skin.value = visible.name;
		else skeleton.setSkin(original);
	}

	function onPlayerSuccess(player: SpinePlayer) {
		spinePlayer = player;
		installAudioListener(player);

		const animations = player.skeleton.data.animations.map(
			(animation: any) => animation.name,
		);

		if (!preview.value) return;
		preview.value.allAnimations = animations;
		layers.value = player.skeleton.data.slots.map((slot: any) => slot.name);
		skins.value = player.skeleton.data.skins.map((skin: any) => skin.name);
		skin.value =
			player.skeleton.skin?.name ??
			player.skeleton.data.defaultSkin?.name ??
			"";

		const initialAnimation =
			source.value?.type === "url" ? source.value.initialAnimation : undefined;

		const animation =
			initialAnimation && animations.includes(initialAnimation)
				? initialAnimation
				: ((preview.value.settings.followGlobalAnimation &&
					animations.includes(previewerStore.globalAnimation)
						? previewerStore.globalAnimation
						: preview.value.settings.currentAnimation) ??
					animations[0] ??
					null);

		if (animation) {
			preview.value.settings.currentAnimation = animation;
			player.setAnimation(animation, preview.value.settings.loopAnimation);
		}

		applyPose();
		pickVisibleSkin(player);
		setupCamera(player);
		void minigame.load(player);

		datingInteraction.load(
			player,
			player.spineAssets.skeletonFilename,
		);

		const currentLoad = loadId, initialChoice = playbackChoice;
		cutscene
			.load(player, player.spineAssets.skeletonFilename)
			.then(() => {
				// Prefer the complete game performance once its timeline is ready.
				if (spinePlayer === player && loadId === currentLoad &&
					playbackChoice === initialChoice && cutscene.available.value)
					playGameCutscene(paused.value);
			})
			.catch((error) =>
				logMessage(`Cutscene could not be loaded: ${error}`, "error"),
			);
		illustrationBackground.load(player.spineAssets.skeletonFilename);
		standing.load(player, player.spineAssets.skeletonFilename);

		if (paused.value) player.pause();
		else player.play();
	}

	function destroyPlayer() {
		releaseSkeletonUrl?.();
		releaseSkeletonUrl = undefined;
		standing.clear();
		illustrationBackground.clear();
		stopActiveAudio();
		isManualSequenceAudio = false;
		sequenceAudioStep = -1;
		if (spinePlayer && audioStateListener)
			spinePlayer.animationState?.removeListener?.(audioStateListener);
		audioStateListener = null;
		cutscene.dispose();
		previousCamera = null;
		void minigame.load(null);
		datingInteraction.load(null);
		activeSequence.value = null;
		cameraListeners?.abort();
		cameraListeners = null;
		camera = null;
		initialCamera = null;
		skins.value = [];
		skin.value = "";
		hiddenAttachments.clear();
		layers.value = [];
		highlightedLayer.value = "";
		hiddenLayers.value = [];
		spinePlayer?.dispose();
		spinePlayer = null;
		playbackTime.value = 0;
		duration.value = 0;
	}

	watch(
		() => previewerStore.controlChange,
		(change) => {
			if (
				!change ||
				change.sourceId === id ||
				preview.value?.syncGroup !== change.groupId
			)

				return;
			applyControl(change.control as PreviewControl);
		},
		{ flush: "sync" },
	);

	watch(
		() => previewerStore.cameraChange,
		(change) => {
			if (!change || !camera || !spinePlayer || change.sourceId === id) return;

			if (
				!preview.value?.syncGroup ||
				preview.value.syncGroup !== change.groupId
			)

				return;

			const width = spinePlayer.canvas.clientWidth;
			const height = spinePlayer.canvas.clientHeight;

			if (!width || !height) return;

			const oldZoom = camera.zoom;

			const zoom = Math.min(
				defaultZoom * 100,
				Math.max(defaultZoom * 0.001, oldZoom * change.zoomRatio),
			);

			camera.x += width * change.anchorX * (oldZoom - zoom);
			camera.y += height * change.anchorY * (oldZoom - zoom);
			camera.zoom = zoom;
			camera.x -= change.dx * width * zoom;
			camera.y += change.dy * height * zoom;
		},
		{ flush: "sync" },
	);

	watch(
		sequenceKey,
		(key) => {
			if (key && !previewerStore.savedSequences[key])
				previewerStore.savedSequences[key] = [];
		},
		{ immediate: true, flush: "sync" },
	);

	watch(
		() => sequences.value.slice(),
		(values) => {
			if (activeSequence.value && !values.includes(activeSequence.value))
				stopSequence();
		},
	);

	watch(minigame.enabled, (value) => {
		if (!value || !settings.value) return;
		stopSequence();
		stopGameCutscene();
		datingInteraction.enabled.value = false;
		settings.value.followGlobalAnimation = false;
		settings.value.paused = false;
		minigame.reset();
	});

	watch(skin, (name) => {
		if (!spinePlayer || !skins.value.includes(name)) return;
		spinePlayer.skeleton.setSkinByName(name);
		if (activeSequence.value) applySequence(playbackTime.value);
		else applyPose();
	});

	watch(() => previewerStore.restartCount, restart);

	watch(currentAnimation, (animation) => {
		standing.cancelMotion();
		stopGameCutscene();

		if (
			datingInteraction.enabled.value ||
			minigame.enabled.value
			// && spinePlayer?.animationState.getCurrent(0)?.animation.name === animation
		) {
			return;
		}

		datingInteraction.reset();
		stopSequence();
		stopActiveAudio();
		isManualSequenceAudio = false;

		if (spinePlayer && animation && allAnimations.value.includes(animation)) {
			// switch immediately, without keeping the previous animation's pose
			spinePlayer.animationState.clearTrack(0);

			spinePlayer.setAnimation(
				animation,
				settings.value?.loopAnimation ?? true,
			);

			applyPose();
		}
	});

	watch(paused, (paused) => {
		if (cutscene.active.value) cutscene.setPaused(paused);
		if (paused) spinePlayer?.pause();
		else spinePlayer?.play();
	}, { flush: "sync" });

	watch(
		() => settings.value?.loopAnimation,
		(loop) => {
			spinePlayer?.animationState.tracks.forEach((track: any) => {
				if (
					track &&
					!datingInteraction.enabled.value &&
					!minigame.enabled.value && !standing.playingMotion.value
				)

					track.loop = loop;
			});
		},
	);

	watch(
		() => settings.value?.background,
		(background) => {
			if (background)
				spinePlayer?.bg.setFromString(
					background.type === "color" ? background.color : "#00000000",
				);
		},
		{ deep: true },
	);

	watch(
		() => settings.value?.premultipliedAlpha,
		(value) => {
			if (spinePlayer) spinePlayer.config.premultipliedAlpha = value;
		},
	);

	watch(
		[source, playerContainer, retryCount, () => library.activeRoot],
		async ([source, container], _previous, onCleanup) => {
			const request = ++loadId;

			onCleanup(() => {
				loadId++;
			});

			destroyPlayer();
			error.value = "";
			errorInfo.value = null;
			loadResults = [];

			if (preview.value) {
				preview.value.allAnimations = [];
				preview.value.settings.currentAnimation = null;
				preview.value.isLoading = !!source && !!container;
			}

			if (!source || !container) return;

			try {
				if (source.type === "folder") {
					await loadSpineFromFolder(source.path, request);
				} else {
					await loadSpineFromUrl(source, request);
				}
			} catch (error) {
				showError(error, request);
			}
		},
		{
			immediate: true,
			flush: "post",
		},
	);

	function copyCanvas(source: HTMLCanvasElement) {
		const copy = document.createElement("canvas");

		copy.width = source.width;
		copy.height = source.height;
		copy.getContext("2d")?.drawImage(source, 0, 0);

		return copy;
	}

	function captureFrame() {
		return new Promise<HTMLCanvasElement>((resolve, reject) => {
			if (!spinePlayer) return reject(new Error("No preview loaded"));

			const timeout = setTimeout(() => {
				frameRequest = null;
				reject(new Error("Timed out waiting for a frame"));
			}, 2000);

			frameRequest = (frame) => {
				clearTimeout(timeout);
				resolve(frame);
			};
		});
	}

	function loadImage(url: string) {
		return new Promise<HTMLImageElement>((resolve, reject) => {
			const image = new Image();

			if (/^https?:/.test(url)) image.crossOrigin = "anonymous";

			image.onload = () => resolve(image);
			image.onerror = () =>
				reject(new Error("Failed to load background image"));
			image.src = url;
		});
	}

	function toPng(canvas: HTMLCanvasElement) {
		return new Promise<Blob>((resolve, reject) =>
			canvas.toBlob(
				(blob) =>
					blob ? resolve(blob) : reject(new Error("Failed to encode PNG")),
				"image/png",
			),
		);
	}

	async function takeScreenshot() {
		const canvas = spinePlayer?.canvas;
		const frame = await captureFrame();
		const imagePath = backgroundImagePath.value;
		const panel = playerContainer.value?.closest(".preview-panel");

		if (!canvas || !imagePath || !panel) return toPng(frame);

		try {
			const image = await loadImage(imagePath);
			const canvasRect = canvas.getBoundingClientRect();
			const panelRect = panel.getBoundingClientRect();
			const ratio = frame.width / canvasRect.width;

			const scale = Math.max(
				panelRect.width / image.naturalWidth,
				panelRect.height / image.naturalHeight,
			);

			const width = image.naturalWidth * scale;
			const height = image.naturalHeight * scale;
			const x = panelRect.left - canvasRect.left + (panelRect.width - width) / 2;
			const y = panelRect.top - canvasRect.top + (panelRect.height - height) / 2;

			const result = document.createElement("canvas");

			result.width = frame.width;
			result.height = frame.height;

			const context = result.getContext("2d")!;

			context.drawImage(image, x * ratio, y * ratio, width * ratio, height * ratio);
			context.drawImage(frame, 0, 0);

			return await toPng(result);
		} catch (error) {
			logMessage("Screenshot background skipped: " + String(error), "warning");

			return toPng(frame);
		}
	}

	onUnmounted(destroyPlayer);

	return {
		standingAvailable: standing.available,
		standingVoiceCount: standing.voiceCount,
		standingVoiceLanguage: standing.voiceLanguage,
		standingAudioStatus: standing.audioStatus,
		illustrationBackground: illustrationBackground.info,
		illustrationBackgroundLoading: illustrationBackground.loading,
		backgroundImagePath,
		error,
		errorInfo,
		isLoading,
		loadSteps,
		retry: () => retryCount.value++,
		cutsceneAvailable: cutscene.available,
		cutsceneActive: cutscene.active,
		cutsceneIncomplete: cutscene.incomplete,
		cutsceneAudioStatus: cutscene.audio.status,
		cutsceneAudioLanguage: cutscene.audio.language,
		cutsceneAudioFallbackCount: cutscene.audio.fallbackCount,
		cutsceneAudioMissingCount: cutscene.audio.missingCount,
		gameBackgroundImages: cutscene.backgroundImages,
		loadingGameImage,
		selectGameBackgroundImage,
		isGameBackgroundImageSelected,
		playGameCutscene: () => runControl({ type: "cutscene" }),
		minigameAvailable: minigame.available,
		minigameEnabled: minigame.enabled,
		minigameFever: minigame.fever,
		minigameFeverAvailable: minigame.feverAvailable,
		datingPoseLoadFailed: datingInteraction.poseLoadFailed,
		datingPoseError: datingInteraction.poseError,
		datingAudioProgress: datingInteraction.audioProgress,
		retryDatingAudio: datingInteraction.retryAudio,
		dismissDatingAudioError: datingInteraction.dismissAudioError,
		datingMarkers: datingInteraction.markers,
		datingGroups: datingInteraction.groups,
		datingGroup: datingInteraction.group,
		selectDatingGroup: datingInteraction.selectGroup,
		datingTools: datingInteraction.tools,
		datingTool: datingInteraction.tool,
		selectDatingTool: datingInteraction.selectTool,
		datingGauge: datingInteraction.gauge,
		datingGaugeRange: datingInteraction.gaugeRange,
		isDating: datingInteraction.isDating,
		datingSceneId: datingInteraction.sceneId,
		datingAvailable: datingInteraction.available,
		datingEnabled: datingInteraction.enabled,
		showDatingPoints: datingInteraction.showPoints,
		showDatingAreas: datingInteraction.showAreas,
		sequences,
		activeSequence,
		playSequence: (sequence: AnimationSequence) =>
			runControl({ type: "sequence", sequence }),
		stopSequence: () => runControl({ type: "stopSequence" }),
		title,
		source,
		settings,
		currentAnimation,
		allAnimations,
		paused,
		loopAnimation,
		animationSelection,
		playbackTime,
		duration,
		seek: (event: Event) =>
			runControl({
				type: "seek",
				time: Number((event.target as HTMLInputElement).value),
			}),
		restart: () => runControl({ type: "restart" }),
		resetCamera: () => runControl({ type: "resetCamera" }),
		fitCharacter: () => runControl({ type: "fit" }),
		centerCharacter: () => runControl({ type: "center" }),
		takeScreenshot,
		skins,
		skin,
		layers,
		highlightedLayer,
		hiddenLayers,
	};
}
