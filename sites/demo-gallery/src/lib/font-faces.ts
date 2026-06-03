/**
 * Central side-effect @fontsource imports for ALL 10 pairings (spec §3.2 / §5
 * file-faces step). Importing this once in BaseLayout ensures any chosen family
 * is bundled by Astro/Vite. Variable packages preferred where they exist; only
 * the families actually referenced by --font-display/--font-body are fetched by
 * the browser (font-display: swap), so shipping all faces is cheap.
 *
 * NOTE: the npm dependencies themselves are added to package.json in a later
 * phase. These imports are the contract that phase must satisfy.
 */

/* editorial-serif */
import '@fontsource-variable/fraunces';
import '@fontsource-variable/newsreader';
import '@fontsource-variable/source-serif-4';

/* modern-grotesk */
import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/inter';

/* warm-humanist */
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/figtree';

/* rugged-slab */
import '@fontsource-variable/bitter';
import '@fontsource/zilla-slab';
/* inter already imported above */

/* classic-trad */
import '@fontsource-variable/playfair-display';
import '@fontsource-variable/lora';

/* clean-sans */
import '@fontsource-variable/albert-sans';

/* organic-serif */
import '@fontsource/spectral';

/* bold-display */
import '@fontsource-variable/archivo';

/* boutique-contrast */
import '@fontsource/cormorant-garamond';
import '@fontsource-variable/mulish';

/* handcrafted */
import '@fontsource-variable/schibsted-grotesk';

export {};
