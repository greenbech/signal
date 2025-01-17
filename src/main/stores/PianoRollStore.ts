import cursorPencil from "!url-loader!../images/cursor-pencil.svg"
import { clamp, flatten, maxBy, minBy } from "lodash"
import { ControllerEvent, PitchBendEvent } from "midifile-ts"
import { action, autorun, computed, makeObservable, observable } from "mobx"
import { IRect } from "../../common/geometry"
import { isNotUndefined } from "../../common/helpers/array"
import { filterEventsWithScroll } from "../../common/helpers/filterEventsWithScroll"
import { BeatWithX, createBeatsInRange } from "../../common/helpers/mapBeats"
import { getMBTString } from "../../common/measure/mbt"
import Quantizer from "../../common/quantizer"
import { ControlSelection } from "../../common/selection/ControlSelection"
import { Selection } from "../../common/selection/Selection"
import {
  isExpressionEvent,
  isModulationEvent,
  isNoteEvent,
  isPanEvent,
  isPitchBendEvent,
  isVolumeEvent,
  TrackEvent,
  TrackEventOf,
} from "../../common/track"
import { NoteCoordTransform } from "../../common/transform"
import { LoadSoundFontEvent } from "../../synth/synth"
import { ControlMode } from "../components/ControlPane/ControlPane"
import { InstrumentSetting } from "../components/InstrumentBrowser/InstrumentBrowser"
import { Layout } from "../Constants"
import RootStore from "./RootStore"

export type PianoRollMouseMode = "pencil" | "selection"

export type PianoNoteItem = IRect & {
  id: number
  velocity: number
  isSelected: boolean
  isDrum: boolean
}

// trackId to trackId[] (not contains itself)
type GhostTrackIdMap = { [index: number]: number[] }

export default class PianoRollStore {
  private rootStore: RootStore

  scrollLeftTicks = 0
  scrollTopKeys = 70 // 中央くらいの音程にスクロールしておく
  SCALE_X_MIN = 0.15
  SCALE_X_MAX = 15
  notesCursor = "auto"
  mouseMode: PianoRollMouseMode = "pencil"
  scaleX = 1
  scaleY = 1
  autoScroll = true
  quantize = 4
  selection: Selection | null = null
  lastNoteDuration: number | null = null
  openInstrumentBrowser = false
  instrumentBrowserSetting: InstrumentSetting = {
    isRhythmTrack: false,
    programNumber: 0,
  }
  presetNames: LoadSoundFontEvent["presetNames"] = [[]]
  ghostTracks: GhostTrackIdMap = {}
  canvasWidth: number = 0
  canvasHeight: number = 0
  showEventList = false

  controlHeight = 0
  controlMode: ControlMode = "velocity"
  controlSelection: ControlSelection | null = null
  selectedControllerEventIds: number[] = []

  constructor(rootStore: RootStore) {
    this.rootStore = rootStore

    makeObservable(this, {
      scrollLeftTicks: observable,
      scrollTopKeys: observable,
      controlHeight: observable,
      notesCursor: observable,
      controlMode: observable,
      mouseMode: observable,
      scaleX: observable,
      scaleY: observable,
      autoScroll: observable,
      quantize: observable,
      selection: observable.shallow,
      lastNoteDuration: observable,
      openInstrumentBrowser: observable,
      instrumentBrowserSetting: observable,
      presetNames: observable,
      ghostTracks: observable,
      canvasWidth: observable,
      canvasHeight: observable,
      showEventList: observable,
      selectedControllerEventIds: observable,
      controlSelection: observable,
      contentWidth: computed,
      contentHeight: computed,
      scrollLeft: computed,
      scrollTop: computed,
      transform: computed,
      windowedEvents: computed,
      notes: computed,
      modulationEvents: computed,
      expressionEvents: computed,
      panEvents: computed,
      volumeEvents: computed,
      pitchBendEvents: computed,
      currentVolume: computed,
      currentPan: computed,
      currentTempo: computed,
      currentMBTTime: computed,
      mappedBeats: computed,
      cursorX: computed,
      quantizer: computed,
      controlCursor: computed,
      setScrollLeftInPixels: action,
      setScrollTopInPixels: action,
      setScrollLeftInTicks: action,
      scaleAroundPointX: action,
      scrollBy: action,
      toggleTool: action,
    })
  }

  setUpAutorun() {
    autorun(() => {
      const { isPlaying, position } = this.rootStore.services.player
      const { autoScroll, scrollLeftTicks, transform, canvasWidth } = this

      // keep scroll position to cursor
      if (autoScroll && isPlaying) {
        const screenX = transform.getX(position - scrollLeftTicks)
        if (screenX > canvasWidth * 0.7 || screenX < 0) {
          this.scrollLeftTicks = position
        }
      }
    })
  }

  get contentWidth(): number {
    const { scrollLeft, transform, canvasWidth } = this
    const trackEndTick = this.rootStore.song.endOfSong
    const startTick = scrollLeft / transform.pixelsPerTick
    const widthTick = transform.getTicks(canvasWidth)
    const endTick = startTick + widthTick
    return Math.max(trackEndTick, endTick) * transform.pixelsPerTick
  }

  get contentHeight(): number {
    const { transform } = this
    return transform.getMaxY()
  }

  get scrollLeft(): number {
    return Math.round(this.transform.getX(this.scrollLeftTicks))
  }

  get scrollTop(): number {
    return Math.round(this.transform.getY(this.scrollTopKeys))
  }

  setScrollLeftInPixels(x: number) {
    const { canvasWidth, contentWidth } = this
    const maxX = contentWidth - canvasWidth
    const scrollLeft = clamp(x, 0, maxX)
    this.scrollLeftTicks = this.transform.getTicks(scrollLeft)
  }

  setScrollTopInPixels(y: number) {
    const { transform, canvasHeight } = this
    const contentHeight = transform.getMaxY()
    const scrollTop = clamp(y, 0, contentHeight - canvasHeight)
    this.scrollTopKeys = this.transform.getNoteNumber(scrollTop)
  }

  setScrollLeftInTicks(tick: number) {
    this.setScrollLeftInPixels(this.transform.getX(tick))
  }

  scrollBy(x: number, y: number) {
    this.setScrollLeftInPixels(this.scrollLeft - x)
    this.setScrollTopInPixels(this.scrollTop - y)
  }

  scaleAroundPointX(scaleXDelta: number, pixelX: number) {
    const pixelXInTicks0 = this.transform.getTicks(this.scrollLeft + pixelX)
    if (this.scaleX < 1) {
      scaleXDelta *= this.scaleX * this.scaleX // to not zoom too fast when zooomed out
    }
    this.scaleX = clamp(
      this.scaleX + scaleXDelta,
      this.SCALE_X_MIN,
      this.SCALE_X_MAX
    )
    const pixelXInTicks1 = this.transform.getTicks(this.scrollLeft + pixelX)
    const scrollInTicks = pixelXInTicks1 - pixelXInTicks0
    this.setScrollLeftInTicks(this.scrollLeftTicks - scrollInTicks)
  }

  toggleTool() {
    this.mouseMode === "pencil" ? "selection" : "pencil"
  }

  get transform(): NoteCoordTransform {
    return new NoteCoordTransform(
      Layout.pixelsPerTick * this.scaleX,
      Layout.keyHeight * this.scaleY,
      127
    )
  }

  get windowedEvents(): TrackEvent[] {
    const { transform, scrollLeft, canvasWidth } = this
    const track = this.rootStore.song.selectedTrack
    if (track === undefined) {
      return []
    }

    return filterEventsWithScroll(
      track.events,
      transform.pixelsPerTick,
      scrollLeft,
      canvasWidth
    )
  }

  get notes(): [PianoNoteItem[], PianoNoteItem[]] {
    const song = this.rootStore.song
    const { selectedTrackId } = song
    const {
      transform,
      windowedEvents,
      ghostTracks,
      selection,
      scrollLeft,
      canvasWidth,
    } = this

    const track = song.selectedTrack
    if (track === undefined) {
      return [[], []]
    }
    const ghostTrackIds = ghostTracks[selectedTrackId] ?? []
    const isRhythmTrack = track.isRhythmTrack

    const noteEvents = windowedEvents.filter(isNoteEvent)

    const getGhostNotes = () =>
      flatten(
        ghostTrackIds.map((id) => {
          const track = song.getTrack(id)
          if (track === undefined) {
            return []
          }
          return filterEventsWithScroll(
            track.events.filter(isNoteEvent),
            transform.pixelsPerTick,
            scrollLeft,
            canvasWidth
          ).map((e): PianoNoteItem => {
            const rect = track.isRhythmTrack
              ? transform.getDrumRect(e)
              : transform.getRect(e)
            return {
              ...rect,
              id: e.id,
              velocity: 127, // draw opaque when ghost
              isSelected: false,
              isDrum: track.isRhythmTrack,
            }
          })
        })
      )

    return [
      noteEvents.map((e): PianoNoteItem => {
        const rect = isRhythmTrack
          ? transform.getDrumRect(e)
          : transform.getRect(e)
        const isSelected = (selection?.noteIds ?? []).includes(e.id)
        return {
          ...rect,
          id: e.id,
          velocity: e.velocity,
          isSelected,
          isDrum: isRhythmTrack,
        }
      }),
      getGhostNotes(),
    ]
  }

  filteredEvents<T extends TrackEvent>(filter: (e: TrackEvent) => e is T): T[] {
    const song = this.rootStore.song
    const { selectedTrack } = song
    const { windowedEvents, scrollLeft, canvasWidth, transform } = this

    const controllerEvents = (selectedTrack?.events ?? []).filter(filter)
    const events = windowedEvents.filter(filter)

    // Add controller events in the outside of the visible area

    const tickStart = scrollLeft / transform.pixelsPerTick
    const tickEnd = (scrollLeft + canvasWidth) / transform.pixelsPerTick

    const prevEvent = maxBy(
      controllerEvents.filter((e) => e.tick < tickStart),
      (e) => e.tick
    )
    const nextEvent = minBy(
      controllerEvents.filter((e) => e.tick > tickEnd),
      (e) => e.tick
    )

    return [prevEvent, ...events, nextEvent].filter(isNotUndefined)
  }

  get modulationEvents(): TrackEventOf<ControllerEvent>[] {
    return this.filteredEvents(isModulationEvent)
  }

  get expressionEvents(): TrackEventOf<ControllerEvent>[] {
    return this.filteredEvents(isExpressionEvent)
  }

  get panEvents(): TrackEventOf<ControllerEvent>[] {
    return this.filteredEvents(isPanEvent)
  }

  get volumeEvents(): TrackEventOf<ControllerEvent>[] {
    return this.filteredEvents(isVolumeEvent)
  }

  get pitchBendEvents(): TrackEventOf<PitchBendEvent>[] {
    return this.filteredEvents(isPitchBendEvent)
  }

  get currentVolume(): number {
    return (
      this.rootStore.song.selectedTrack?.getVolume(
        this.rootStore.services.player.position
      ) ?? 0
    )
  }

  get currentPan(): number {
    return (
      this.rootStore.song.selectedTrack?.getPan(
        this.rootStore.services.player.position
      ) ?? 0
    )
  }

  get currentTempo(): number {
    return (
      this.rootStore.song.conductorTrack?.getTempo(
        this.rootStore.services.player.position
      ) ?? 1
    )
  }

  get currentMBTTime(): string {
    return getMBTString(
      this.rootStore.song.measures,
      this.rootStore.services.player.position,
      this.rootStore.song.timebase
    )
  }

  get cursorX(): number {
    return this.transform.getX(this.rootStore.services.player.position)
  }

  get mappedBeats(): BeatWithX[] {
    const { scrollLeft, transform, canvasWidth } = this

    const startTick = scrollLeft / transform.pixelsPerTick

    return createBeatsInRange(
      this.rootStore.song.measures,
      transform.pixelsPerTick,
      this.rootStore.song.timebase,
      startTick,
      canvasWidth
    )
  }

  get quantizer(): Quantizer {
    return new Quantizer(this.rootStore.song.timebase, this.quantize)
  }

  get controlCursor(): string {
    return this.mouseMode === "pencil"
      ? `url("${cursorPencil}") 0 20, pointer`
      : "auto"
  }
}
