const EMPTY_INDEX = 0;

/*
 * Indexed color helper built around how the Maschine mk3 indexed color
 * implementation notes.
 */

// Here's a bunch of stuff I wrote up for my node-traktor-f1 fork about how the
// colors work.  It's useful to leave there, but I think also useful to have
// here since I don't really want to tie us to whatever happens in
// led_indexed.js too tightly/at all.

/* The Maschine mk3 supports a finite indexed set of LED colors.  (Presumably
 * this simplifies things for the drivers, especially on USB bus power.)
 *
 * The NI Controller Editor PDF provides a table that's pretty accurate, noting
 * that the mk3 touch slider dot LEDs and directional encoder dot LEDs cannot do
 * white; they get truncated to be colors.  They may also exist in a somewhat
 * different color-space.

 * For each color, there are 4 variants: "dim", "dim flash", "bright", and
 * "flash".  "Flash" seems to be intended to mean "pressed" and seems to be a
 * whiter, less saturated version of the base color.  That is, the colors don't
 * form a line in any color-space, but rather a square.  This is much more
 * noticable for the dot LEDs than the pad LEDs.  At least in daylight, the
 * "dim flash" color usually looks like it's on a 3-color linear HSV value
 * ramp, although for some colors there's a hint of discoloration in the middle.
 * And the "flash" color looks notably whiter.  With daylight involved, however,
 * it seems like "dim" is too dim and it's better to only use the upper 3 colors
 * which should be largely distinguishable.
 *
 * The 16 colors are roughly hue-spaced.  NI has basically chosen to add "warm
 * yellow", deleting an extra weird green-cyan color.  While I don't really
 * miss the deleted color, the yellows are super hard to visually distinguish
 * compared to the lost color, so it's not much of a win.
 */
const colorTable = [
  'red',
  'orange',
  'light orange',
  'warm yellow', // in hue space this would just be yellow
  'yellow', // in hue space this would be lime
  'lime', // in hue space this would be green
  'green', // in hue space this would be mint
  'mint', // in hue space this would be a greenish-cyan
  'cyan',
  'turquoise',
  'blue',
  'plum',
  'violet',
  'purple',
  'magenta',
  'fuschia'
];
const COLORS_START_OFFSET = 4;
const WHITE_START_OFFSET = 68;
const DIM_OFFSET = 0;
const DIM_FLASH_OFFSET = 1;
const BRIGHT_OFFSET = 2;
const BRIGHT_FLASH_OFFSET = 3;

/**
 * Mk3-style indexed color helper.  We store the color as { colorIndex } where
 * colorIndex is a value in the inclusive range [0, 15].
 */
class ColorHelper {
  makeRandomColor() {
    return { colorIndex: Math.min(Math.floor(Math.random() * 16), 15) };
  }

  /**
   * Generate a color-bank color.  For the mk3, we only support 16 colors for
   * now since.
   */
  computeColorBankColor(iBank, nBanks, iCell, nCells) {
    return { colorIndex: iCell };
  }

  computeEmptyDisplayColor() {
    return EMPTY_INDEX;
  }

  /**
   * Compute the actual display values to return, since this is the RGB class,
   * an [r,g,b] tuple is returned.  The indexed variant returns a single index.
   */
  computeBookmarkDisplayColor(wrapped, state, brightnessScale) {
    let brightness;
    switch (state) {
      case 'focused':
        brightness = BRIGHT_FLASH_OFFSET;
        break
      case 'visible':
        brightness = BRIGHT_OFFSET;
        break;
      case 'hidden':
        brightness = DIM_FLASH_OFFSET;
        break;
      case 'missing':
        brightness = DIM_OFFSET;
        break;
      default:
        throw new Error("unknown visibility: " + state);
    }

    return COLORS_START_OFFSET + wrapped.colorIndex * 4 + brightness;
  }

  computeDisplayColor(wrapped) {
    return COLORS_START_OFFSET + wrapped.colorIndex * 4 + BRIGHT_OFFSET;
  }
}

module.exports.ColorHelper = new ColorHelper();