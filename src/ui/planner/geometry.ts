export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Rectangle extends Point {
  readonly width: number;
  readonly height: number;
}

export interface PlannerTimeBounds {
  readonly startMinutes: number;
  readonly endMinutes: number;
}

export interface SpiralGeometry {
  readonly width: number;
  readonly height: number;
  readonly center: Point;
  readonly innerRadius: number;
  readonly outerRadius: number;
  readonly bandWidth: number;
  readonly bounds: PlannerTimeBounds;
}

export interface SpiralViewBox extends Rectangle {}

export interface SpiralTick {
  readonly minute: number;
  readonly label: string;
  readonly inner: Point;
  readonly outer: Point;
  readonly labelPoint: Point;
}

export interface RailLabelInput {
  readonly id: string;
  readonly minute: number;
  readonly anchor: Point;
  readonly width: number;
  readonly height: number;
}

export interface RailLabelPlacement extends RailLabelInput {
  readonly side: "left" | "right";
  readonly track: number;
  readonly box: Rectangle;
  readonly connectorEnd: Point;
}

export interface RailPlacementOptions {
  readonly minimumGap?: number;
  readonly nearbyTracks?: number;
  readonly trackGap?: number;
  readonly reserved?: readonly Rectangle[];
}

export interface TooltipPlacementInput {
  readonly anchor: Rectangle;
  readonly tooltipWidth: number;
  readonly tooltipHeight: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly margin?: number;
  readonly gap?: number;
}

export interface TooltipPlacement extends Point {
  readonly side: "top" | "right" | "bottom" | "left";
}

const FULL_TURN_MINUTES = 12 * 60;
const WIDE_GEOMETRY = Object.freeze({
  width: 600,
  height: 420,
  center: Object.freeze({ x: 300, y: 210 }),
  innerRadius: 50,
  outerRadius: 150,
  bandWidth: 16,
});
const COMPACT_SCALE = 0.7;

function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
  return value;
}

export function validatePlannerTimeBounds(bounds: PlannerTimeBounds): PlannerTimeBounds {
  finite(bounds.startMinutes, "startMinutes");
  finite(bounds.endMinutes, "endMinutes");
  if (bounds.startMinutes < 0 || bounds.endMinutes > 24 * 60
    || bounds.endMinutes <= bounds.startMinutes) {
    throw new RangeError("Planner bounds must be inside one day with end after start");
  }
  return Object.freeze({ ...bounds });
}

export function createSpiralGeometry(
  bounds: PlannerTimeBounds,
  compact = false,
): SpiralGeometry {
  const validated = validatePlannerTimeBounds(bounds);
  if (!compact) return Object.freeze({ ...WIDE_GEOMETRY, bounds: validated });
  return Object.freeze({
    width: 450,
    height: 315,
    center: Object.freeze({ x: 225, y: 157.5 }),
    innerRadius: WIDE_GEOMETRY.innerRadius * COMPACT_SCALE,
    outerRadius: WIDE_GEOMETRY.outerRadius * COMPACT_SCALE,
    bandWidth: WIDE_GEOMETRY.bandWidth * COMPACT_SCALE,
    bounds: validated,
  });
}

function radians(degrees: number): number {
  return degrees * Math.PI / 180;
}

export function spiralAngle(minute: number, geometry: SpiralGeometry): number {
  return -90 + (finite(minute, "minute") - geometry.bounds.startMinutes)
    / FULL_TURN_MINUTES * 360;
}

export function spiralRadius(minute: number, geometry: SpiralGeometry): number {
  const progress = Math.max(0, Math.min(
    1,
    (finite(minute, "minute") - geometry.bounds.startMinutes)
      / (geometry.bounds.endMinutes - geometry.bounds.startMinutes),
  ));
  return geometry.innerRadius
    + (geometry.outerRadius - geometry.innerRadius) * progress;
}

export function spiralPoint(
  minute: number,
  geometry: SpiralGeometry,
  radialOffset = 0,
): Point {
  const angle = radians(spiralAngle(minute, geometry));
  const radius = spiralRadius(minute, geometry) + radialOffset;
  return Object.freeze({
    x: geometry.center.x + Math.cos(angle) * radius,
    y: geometry.center.y + Math.sin(angle) * radius,
  });
}

function pathPoint(point: Point): string {
  return `${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
}

export function spiralBandPath(
  startMinutes: number,
  endMinutes: number,
  geometry: SpiralGeometry,
): string {
  const start = Math.max(geometry.bounds.startMinutes, finite(startMinutes, "startMinutes"));
  const end = Math.min(geometry.bounds.endMinutes, finite(endMinutes, "endMinutes"));
  if (end <= start) return "";
  const samples = Math.max(2, Math.ceil((end - start) / 12));
  const outer: Point[] = [];
  const inner: Point[] = [];
  for (let index = 0; index <= samples; index += 1) {
    const minute = start + (end - start) * index / samples;
    outer.push(spiralPoint(minute, geometry, geometry.bandWidth / 2));
    inner.push(spiralPoint(minute, geometry, -geometry.bandWidth / 2));
  }
  return `M ${pathPoint(outer[0]!)} ${outer.slice(1).map((point) => `L ${pathPoint(point)}`).join(" ")}`
    + ` ${inner.reverse().map((point) => `L ${pathPoint(point)}`).join(" ")} Z`;
}

export function spiralNeedlePath(minute: number, geometry: SpiralGeometry): string {
  const angle = radians(spiralAngle(minute, geometry));
  const inner = Math.max(0, geometry.innerRadius - 11);
  const outer = spiralRadius(minute, geometry) + geometry.bandWidth;
  const from = {
    x: geometry.center.x + Math.cos(angle) * inner,
    y: geometry.center.y + Math.sin(angle) * inner,
  };
  const to = {
    x: geometry.center.x + Math.cos(angle) * outer,
    y: geometry.center.y + Math.sin(angle) * outer,
  };
  return `M ${pathPoint(from)} L ${pathPoint(to)}`;
}

export function formatHourLabel(minute: number): string {
  const hour = Math.floor(minute / 60) % 24;
  return String(hour === 24 ? 0 : hour);
}

export function buildHourTicks(geometry: SpiralGeometry): readonly SpiralTick[] {
  const ticks: SpiralTick[] = [];
  const firstHour = Math.ceil(geometry.bounds.startMinutes / 60) * 60;
  for (let minute = firstHour; minute <= geometry.bounds.endMinutes; minute += 60) {
    ticks.push(Object.freeze({
      minute,
      label: minute === 24 * 60 ? "0" : formatHourLabel(minute),
      inner: spiralPoint(minute, geometry, -geometry.bandWidth / 2 - 3),
      outer: spiralPoint(minute, geometry, geometry.bandWidth / 2 + 3),
      labelPoint: spiralPoint(minute, geometry, geometry.bandWidth / 2 + 13),
    }));
  }
  return Object.freeze(ticks);
}

export function rectanglesOverlap(left: Rectangle, right: Rectangle, gap = 0): boolean {
  return left.x < right.x + right.width + gap
    && left.x + left.width + gap > right.x
    && left.y < right.y + right.height + gap
    && left.y + left.height + gap > right.y;
}

function verticalOffset(attempt: number, rowStep: number): number {
  if (attempt === 0) return 0;
  const distance = Math.ceil(attempt / 2) * rowStep;
  return attempt % 2 === 1 ? distance : -distance;
}

export function placeRailLabels(
  labels: readonly RailLabelInput[],
  geometry: SpiralGeometry,
  options: RailPlacementOptions = {},
): readonly RailLabelPlacement[] {
  const minimumGap = options.minimumGap ?? 4;
  const nearbyTracks = options.nearbyTracks ?? 3;
  const trackGap = options.trackGap ?? 18;
  const reserved = [...(options.reserved ?? [])];
  const placed: RailLabelPlacement[] = [];
  const maxRadius = geometry.outerRadius + geometry.bandWidth / 2;
  const sideRail = {
    left: geometry.center.x - maxRadius - 20,
    right: geometry.center.x + maxRadius + 20,
  } as const;

  const ordered = [...labels].sort((left, right) => {
    const leftSide = left.anchor.x < geometry.center.x ? "left" : "right";
    const rightSide = right.anchor.x < geometry.center.x ? "left" : "right";
    if (leftSide !== rightSide) return leftSide === "left" ? -1 : 1;
    const direction = leftSide === "left" ? -1 : 1;
    return direction * (left.anchor.y - right.anchor.y)
      || direction * (left.minute - right.minute)
      || left.id.localeCompare(right.id);
  });

  for (const label of ordered) {
    const side = label.anchor.x < geometry.center.x ? "left" : "right";
    const rowStep = label.height + minimumGap;
    let placement: RailLabelPlacement | undefined;
    const maxVerticalAttempts = Math.max(8, ordered.length * 2);
    for (let outward = 0; outward < nearbyTracks + ordered.length && !placement; outward += 1) {
      const verticalAttempts = outward < nearbyTracks ? nearbyTracks : maxVerticalAttempts;
      for (let vertical = 0; vertical < verticalAttempts && !placement; vertical += 1) {
        const rail = side === "left"
          ? sideRail.left - outward * trackGap
          : sideRail.right + outward * trackGap;
        const x = side === "left" ? rail - label.width : rail;
        const y = label.anchor.y - label.height / 2 + verticalOffset(vertical, rowStep);
        const box = { x, y, width: label.width, height: label.height };
        if (box.y < 2 || box.y + box.height > geometry.height - 2) continue;
        if ([...reserved, ...placed.map((entry) => entry.box)]
          .some((occupied) => rectanglesOverlap(box, occupied, minimumGap))) continue;
        placement = Object.freeze({
          ...label,
          side,
          track: outward,
          box: Object.freeze(box),
          connectorEnd: Object.freeze({
            x: side === "left" ? box.x + box.width + 3 : box.x - 3,
            y: box.y + box.height / 2,
          }),
        });
      }
    }
    if (!placement) {
      throw new RangeError(`Unable to place planner label ${label.id} without collision`);
    }
    placed.push(placement);
  }
  return Object.freeze(placed);
}

export function spiralViewBox(
  geometry: SpiralGeometry,
  labels: readonly RailLabelPlacement[],
  padding = 8,
): SpiralViewBox {
  finite(padding, "padding");
  if (padding < 0) throw new RangeError("padding must not be negative");
  const horizontalPoints = labels.flatMap(({ anchor, box, connectorEnd }) => [
    anchor.x,
    connectorEnd.x,
    box.x - padding,
    box.x + box.width + padding,
  ]);
  const minimumX = Math.min(0, ...horizontalPoints);
  const maximumX = Math.max(geometry.width, ...horizontalPoints);
  return Object.freeze({
    x: minimumX,
    y: 0,
    width: maximumX - minimumX,
    height: geometry.height,
  });
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function placeTooltip(input: TooltipPlacementInput): TooltipPlacement {
  const margin = input.margin ?? 12;
  const gap = input.gap ?? 10;
  const available = {
    top: input.anchor.y - margin,
    right: input.viewportWidth - margin - (input.anchor.x + input.anchor.width),
    bottom: input.viewportHeight - margin - (input.anchor.y + input.anchor.height),
    left: input.anchor.x - margin,
  };
  const preferred: TooltipPlacement["side"][] = ["top", "right", "bottom", "left"];
  const required = {
    top: input.tooltipHeight + gap,
    right: input.tooltipWidth + gap,
    bottom: input.tooltipHeight + gap,
    left: input.tooltipWidth + gap,
  };
  const side = preferred.find((candidate) => available[candidate] >= required[candidate])
    ?? preferred.sort((left, right) => available[right] - available[left])[0]!;
  const centeredX = input.anchor.x + input.anchor.width / 2 - input.tooltipWidth / 2;
  const centeredY = input.anchor.y + input.anchor.height / 2 - input.tooltipHeight / 2;
  const raw = side === "top"
    ? { x: centeredX, y: input.anchor.y - input.tooltipHeight - gap }
    : side === "right"
      ? { x: input.anchor.x + input.anchor.width + gap, y: centeredY }
      : side === "bottom"
        ? { x: centeredX, y: input.anchor.y + input.anchor.height + gap }
        : { x: input.anchor.x - input.tooltipWidth - gap, y: centeredY };
  return Object.freeze({
    side,
    x: clamp(raw.x, margin, Math.max(margin, input.viewportWidth - margin - input.tooltipWidth)),
    y: clamp(raw.y, margin, Math.max(margin, input.viewportHeight - margin - input.tooltipHeight)),
  });
}
