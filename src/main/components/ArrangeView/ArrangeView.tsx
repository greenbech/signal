import useComponentSize from "@rehooks/component-size"
import Color from "color"
import { partition } from "lodash"
import { observer } from "mobx-react-lite"
import { FC, useCallback, useEffect, useRef, useState } from "react"
import styled from "styled-components"
import {
  containsPoint,
  IPoint,
  pointAdd,
  pointSub,
  zeroRect,
} from "../../../common/geometry"
import {
  arrangeEndSelection,
  arrangeMoveSelection,
  arrangeResizeSelection,
  arrangeStartSelection,
  selectTrack,
} from "../../actions"
import { Layout } from "../../Constants"
import { getClientPos } from "../../helpers/mouseEvent"
import { observeDrag } from "../../helpers/observeDrag"
import { useContextMenu } from "../../hooks/useContextMenu"
import { useStores } from "../../hooks/useStores"
import { useTheme } from "../../hooks/useTheme"
import { GLCanvas } from "../GLCanvas/GLCanvas"
import { HorizontalScaleScrollBar } from "../inputs/ScaleScrollBar"
import { BAR_WIDTH, VerticalScrollBar } from "../inputs/ScrollBar"
import CanvasPianoRuler from "../PianoRoll/CanvasPianoRuler"
import { ArrangeContextMenu } from "./ArrangeContextMenu"
import { ArrangeTrackContextMenu } from "./ArrangeTrackContextMenu"
import { ArrangeViewRenderer } from "./ArrangeViewRenderer"

const Wrapper = styled.div`
  flex-grow: 1;
  display: flex;
  flex-direction: row;
  position: relative;
  background: var(--background-color);
  overflow: hidden;
`

const LeftTopSpace = styled.div`
  z-index: 999;
  position: absolute;
  width: 100%;
  box-sizing: border-box;
  border-bottom: 1px solid var(--divider-color);
  background: var(--background-color);
`

const LeftBottomSpace = styled.div`
  position: absolute;
  left: 0;
  bottom: 0;
  width: 100%;
  background: var(--background-color);
`

const TrackHeader = styled.div<{ isSelected: boolean }>`
  width: 8rem;
  padding: 0 0.5rem;
  box-sizing: border-box;
  display: flex;
  border-bottom: 1px solid var(--divider-color);
  align-items: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  background-color: ${({ isSelected, theme }) =>
    isSelected ? theme.secondaryBackgroundColor : theme.backgroundColor};
`

const HeaderList = styled.div`
  position: relative;
  border-right: 1px solid var(--divider-color);
`

type DragHandler = (
  e: MouseEvent,
  mouseMove: (handler: (e: MouseEvent, delta: IPoint) => void) => void,
  mouseUp: (handler: (e: MouseEvent) => void) => void
) => void

export const ArrangeView: FC = observer(() => {
  const rootStore = useStores()

  const tracks = rootStore.song.tracks

  const { arrangeViewStore: s } = rootStore

  const ref = useRef(null)
  const size = useComponentSize(ref)

  const {
    notes,
    cursorX,
    selection,
    mappedBeats,
    selectionRect,
    trackHeight,
    contentWidth,
    transform,
    trackTransform,
    scrollLeft,
    scrollTop,
    selectedTrackId,
  } = rootStore.arrangeViewStore

  const setScrollLeft = useCallback(
    (v: number) => rootStore.arrangeViewStore.setScrollLeftInPixels(v),
    []
  )
  const setScrollTop = useCallback(
    (v: number) => rootStore.arrangeViewStore.setScrollTop(v),
    []
  )

  const containerWidth = size.width
  const contentHeight = trackHeight * tracks.length

  const theme = useTheme()

  useEffect(() => {
    rootStore.arrangeViewStore.canvasWidth = size.width
  }, [size.width])

  useEffect(() => {
    rootStore.arrangeViewStore.canvasHeight = size.height
  }, [size.height])

  const onClickScaleUp = useCallback(() => (s.scaleX += 0.1), [s])
  const onClickScaleDown = useCallback(
    () => (s.scaleX = Math.max(0.05, s.scaleX - 0.1)),
    [s]
  )
  const onClickScaleReset = useCallback(() => (s.scaleX = 1), [s])

  const handleLeftClick = useCallback(
    (e: React.MouseEvent) => {
      const startPosPx: IPoint = {
        x: e.nativeEvent.offsetX + scrollLeft,
        y: e.nativeEvent.offsetY - Layout.rulerHeight + scrollTop,
      }

      const isSelectionSelected =
        selectionRect != null && containsPoint(selectionRect, startPosPx)

      const createSelectionHandler: DragHandler = (e, mouseMove, mouseUp) => {
        const startPos = trackTransform.getArrangePoint(startPosPx)
        arrangeStartSelection(rootStore)(startPos)

        if (!rootStore.services.player.isPlaying) {
          rootStore.services.player.position =
            rootStore.arrangeViewStore.quantizer.round(startPos.tick)
        }

        rootStore.arrangeViewStore.selectedTrackId = Math.floor(
          startPos.trackIndex
        )

        mouseMove((e, deltaPx) => {
          const selectionToPx = pointAdd(startPosPx, deltaPx)
          arrangeResizeSelection(rootStore)(
            startPos,
            trackTransform.getArrangePoint(selectionToPx)
          )
        })
        mouseUp((e) => {
          arrangeEndSelection(rootStore)()
        })
      }

      const dragSelectionHandler: DragHandler = (e, mouseMove, mouseUp) => {
        if (selectionRect == null) {
          return
        }

        mouseMove((e, deltaPx) => {
          const selectionFromPx = pointAdd(deltaPx, selectionRect)
          arrangeMoveSelection(rootStore)(
            trackTransform.getArrangePoint(selectionFromPx)
          )
        })
        mouseUp((e) => {})
      }

      let handler

      if (isSelectionSelected) {
        handler = dragSelectionHandler
      } else {
        handler = createSelectionHandler
      }

      let mouseMove: (e: MouseEvent, delta: IPoint) => void
      let mouseUp: (e: MouseEvent) => void
      handler(
        e.nativeEvent,
        (fn) => (mouseMove = fn),
        (fn) => (mouseUp = fn)
      )

      const startClientPos = getClientPos(e.nativeEvent)

      observeDrag({
        onMouseMove: (e) =>
          mouseMove(e, pointSub(getClientPos(e), startClientPos)),
        onMouseUp: (e) => mouseUp(e),
      })
    },
    [selection, trackTransform, rootStore, scrollLeft, scrollTop]
  )

  const handleMiddleClick = useCallback(
    (e: React.MouseEvent) => {
      function createPoint(e: MouseEvent) {
        return { x: e.clientX, y: e.clientY }
      }
      const startPos = createPoint(e.nativeEvent)

      observeDrag({
        onMouseMove(e) {
          const pos = createPoint(e)
          const delta = pointSub(pos, startPos)
          setScrollLeft(Math.max(0, scrollLeft - delta.x))
          setScrollTop(Math.max(0, scrollTop - delta.y))
        },
      })
    },
    [scrollLeft, scrollTop]
  )

  const { onContextMenu, menuProps } = useContextMenu()
  const { onContextMenu: onTrackContextMenu, menuProps: trackMenuProps } =
    useContextMenu()

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      switch (e.button) {
        case 0:
          handleLeftClick(e)
          break
        case 1:
          handleMiddleClick(e)
          break
        case 2:
          onContextMenu(e)
          break
        default:
          break
      }
    },
    [handleLeftClick, handleMiddleClick, onContextMenu]
  )

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      const scrollLineHeight = trackHeight
      const delta = scrollLineHeight * (e.deltaY > 0 ? 1 : -1)
      setScrollTop(scrollTop + delta)
    },
    [scrollTop]
  )

  const [renderer, setRenderer] = useState<ArrangeViewRenderer | null>(null)

  useEffect(() => {
    if (renderer === null) {
      return
    }

    const [highlightedBeats, nonHighlightedBeats] = partition(
      mappedBeats,
      (b) => b.beat === 0
    )

    renderer.theme = theme
    renderer.render(
      cursorX,
      notes,
      selectionRect ?? zeroRect,
      nonHighlightedBeats.map((b) => b.x),
      highlightedBeats.map((b) => b.x),
      tracks.map((_, i) => trackHeight * (i + 1) - 1),
      { x: scrollLeft, y: scrollTop }
    )
  }, [
    renderer,
    tracks.length,
    scrollLeft,
    scrollTop,
    cursorX,
    notes,
    mappedBeats,
    selectionRect,
  ])

  const openTrack = (trackId: number) => {
    rootStore.router.pushTrack()
    selectTrack(rootStore)(trackId)
  }

  return (
    <Wrapper>
      <HeaderList>
        <LeftTopSpace style={{ height: Layout.rulerHeight }} />
        <div
          style={{
            marginTop: Layout.rulerHeight,
            transform: `translateY(${-scrollTop}px)`,
          }}
        >
          {tracks.map((t, i) => (
            <TrackHeader
              style={{ height: trackHeight }}
              key={i}
              isSelected={i === selectedTrackId}
              onClick={() => (rootStore.arrangeViewStore.selectedTrackId = i)}
              onDoubleClick={() => openTrack(i)}
              onContextMenu={(e) => {
                rootStore.arrangeViewStore.selectedTrackId = i
                onTrackContextMenu(e)
              }}
            >
              {t.displayName}
            </TrackHeader>
          ))}
        </div>
        <LeftBottomSpace style={{ height: BAR_WIDTH }} />
      </HeaderList>
      <div
        style={{
          display: "flex",
          flexGrow: 1,
          flexDirection: "column",
          position: "relative",
        }}
      >
        <div
          ref={ref}
          onMouseDown={onMouseDown}
          onContextMenu={useCallback((e) => e.preventDefault(), [])}
          onWheel={onWheel}
          style={{
            display: "flex",
            flexGrow: 1,
            flexDirection: "column",
            position: "relative",
            overflow: "hidden",
            background: Color(theme.backgroundColor).darken(0.1).hex(),
          }}
        >
          <CanvasPianoRuler
            width={containerWidth}
            beats={mappedBeats}
            scrollLeft={scrollLeft}
            pixelsPerTick={transform.pixelsPerTick}
            style={{
              background: theme.backgroundColor,
              borderBottom: `1px solid ${theme.dividerColor}`,
              boxSizing: "border-box",
            }}
          />
          <GLCanvas
            style={{ pointerEvents: "none" }}
            onCreateContext={useCallback(
              (gl) => setRenderer(new ArrangeViewRenderer(gl)),
              []
            )}
            width={containerWidth}
            height={contentHeight}
          />
        </div>
        <div
          style={{
            width: `calc(100% - ${BAR_WIDTH}px)`,
            position: "absolute",
            bottom: 0,
          }}
        >
          <HorizontalScaleScrollBar
            scrollOffset={scrollLeft}
            contentLength={contentWidth}
            onScroll={setScrollLeft}
            onClickScaleUp={onClickScaleUp}
            onClickScaleDown={onClickScaleDown}
            onClickScaleReset={onClickScaleReset}
          />
        </div>
      </div>
      <div
        style={{
          height: `calc(100% - ${BAR_WIDTH}px)`,
          position: "absolute",
          top: 0,
          right: 0,
        }}
      >
        <VerticalScrollBar
          scrollOffset={scrollTop}
          contentLength={contentHeight + Layout.rulerHeight}
          onScroll={setScrollTop}
        />
      </div>
      <div
        style={{
          width: BAR_WIDTH,
          height: BAR_WIDTH,
          position: "absolute",
          bottom: 0,
          right: 0,
          background: theme.backgroundColor,
        }}
      />
      <ArrangeContextMenu {...menuProps} />
      <ArrangeTrackContextMenu {...trackMenuProps} />
    </Wrapper>
  )
})
