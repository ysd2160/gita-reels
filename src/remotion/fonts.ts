import { loadFont as loadDevanagari } from '@remotion/google-fonts/NotoSansDevanagari';
import { loadFont as loadPoppins } from '@remotion/google-fonts/Poppins';

export const devanagari = loadDevanagari('normal', { weights: ['700'], subsets: ['devanagari', 'latin'] }).fontFamily;
export const poppins = loadPoppins('normal', { weights: ['600', '800'], subsets: ['latin'] }).fontFamily;
