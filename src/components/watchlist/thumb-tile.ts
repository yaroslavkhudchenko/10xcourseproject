// A product without a photo shows its brand's initial on one of four pastel tiles, global.css's --tile-1 to --tile-4,
// picked from the brand alone, so a brand keeps its tile on every row and page. ProductThumb draws it, in .astro files
// and in the price island, so this module imports nothing.

/** The four tiles, as global.css numbers them. */
export const TILES = [1, 2, 3, 4] as const;

/** One of the tiles. */
export type Tile = (typeof TILES)[number];

/** A brand as its tile and initial read it: without the spaces around it, and composed, so "Ł" is one character. */
function trimmed(brand: string | null): string {
  return (brand ?? "").trim().normalize("NFC");
}

/**
 * The brand's tile: always the same for the same brand, whatever its case or the spaces around it, and spread over the
 * four across brands by an FNV-1a hash of its name, whose high half is folded into the low bits it picks from. A
 * product without a brand gets the first tile.
 */
export function tileOf(brand: string | null): Tile {
  const name = trimmed(brand).toLocaleLowerCase("pl-PL");
  if (name === "") {
    return 1;
  }
  let hash = 0x811c9dc5;
  for (let index = 0; index < name.length; index++) {
    hash ^= name.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  // FNV-1a's lowest bits alone spread short names poorly: most brands fell on one tile.
  const folded = (hash ^ (hash >>> 16)) >>> 0;
  return TILES[folded % TILES.length];
}

/** The initial the tile shows: the brand's first letter or digit, in upper case, or "?" for a product without one. */
export function initialOf(brand: string | null): string {
  const first = /[\p{L}\p{N}]/u.exec(trimmed(brand));
  return first === null ? "?" : first[0].toLocaleUpperCase("pl-PL");
}
