// Every plant in the module is a potted houseplant, so the pot is shared. It is
// static: the pot does not change with the watering state, which keeps the eye
// on the foliage.
export function PlantPot() {
  return (
    <g data-plant-part="pot" aria-hidden="true">
      <path d="M 30 86 L 90 86 L 85 112 L 35 112 Z" fill="#C97B5A" />
      <path d="M 30 86 L 90 86 L 88 95 L 32 95 Z" fill="#B4674A" opacity="0.55" />
      <rect x="27" y="79" width="66" height="9" rx="4" fill="#D08B6B" />
      <ellipse cx="60" cy="83" rx="29" ry="5" fill="#4A3B30" />
      <ellipse cx="53" cy="82.5" rx="9" ry="2.2" fill="#5B4A3C" opacity="0.8" />
    </g>
  );
}
