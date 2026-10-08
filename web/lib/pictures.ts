import type { StaticImageData } from "next/image";
import arieneo48537322302 from "@/pictures/arieneo-48537322302.jpg";
import raoul30441782607 from "@/pictures/raoul-30441782607.jpg";
import raoul31241378917 from "@/pictures/raoul-31241378917.jpg";
import raoul31867603928 from "@/pictures/raoul-31867603928.jpg";
import raoul41663107162 from "@/pictures/raoul-41663107162.jpg";
import raoul42971102521 from "@/pictures/raoul-42971102521.jpg";
import raoul44402204562 from "@/pictures/raoul-44402204562.jpg";
import raoul44799036785 from "@/pictures/raoul-44799036785.jpg";
import raoul45014160084 from "@/pictures/raoul-45014160084.jpg";
import raoul45120650855 from "@/pictures/raoul-45120650855.jpg";
import raoul48325577926 from "@/pictures/raoul-48325577926.jpg";
import raoul48325936481 from "@/pictures/raoul-48325936481.jpg";
import raoul48340609227 from "@/pictures/raoul-48340609227.jpg";
import raoul48408781722 from "@/pictures/raoul-48408781722.jpg";
import raoul48494606591 from "@/pictures/raoul-48494606591.jpg";
import raoul48695092918 from "@/pictures/raoul-48695092918.jpg";
import raoul47272219531 from "@/pictures/raoul-47272219531.jpg";
import rellim41638209562 from "@/pictures/rellim-41638209562.jpg";
import yajih41594388540 from "@/pictures/yajih-41594388540.jpg";

/**
 * Every picture on the site is a Star Citizen screenshot that its author has
 * published on Flickr under a Creative Commons licence. The licences ask for
 * the author to be named and the licence linked, which the corner of each
 * picture and the credits page do. They also bar commercial use, which suits
 * a fan site. Each licence was checked on the picture's own page on 8 October 2026.
 */

export type Licence = { name: string; url: string };

const byNc: Licence = { name: "CC BY-NC 2.0", url: "https://creativecommons.org/licenses/by-nc/2.0/" };
const byNcSa: Licence = { name: "CC BY-NC-SA 2.0", url: "https://creativecommons.org/licenses/by-nc-sa/2.0/" };

type Author = { name: string; url: string };

const raoul: Author = { name: "Captain_Raoul", url: "https://www.flickr.com/photos/156307102@N07" };
const arieNeo: Author = { name: "ArieNeo", url: "https://www.flickr.com/photos/183426206@N07" };
const yajih: Author = { name: "yajih", url: "https://www.flickr.com/photos/143015670@N06" };
const jonRellim: Author = { name: "Jon-Rellim", url: "https://www.flickr.com/photos/86001647@N00" };

/** One screenshot: the file, whose it is, and where it came from. */
export type Shot = {
  id: string;
  image: StaticImageData;
  author: Author;
  /** The title its author gave it. */
  title: string;
  /** The page it was taken from. */
  page: string;
  licence: Licence;
};

const shot = (id: string, image: StaticImageData, author: Author, title: string, licence: Licence): Shot => ({
  id,
  image,
  author,
  title,
  page: `${author.url}/${id}`,
  licence,
});

export const shots = {
  raoul48325577926: shot("48325577926", raoul48325577926, raoul, "Star Citizen", byNc),
  arieneo48537322302: shot("48537322302", arieneo48537322302, arieNeo, "StarCitizen 2019-02-03 00-41-03", byNcSa),
  raoul41663107162: shot("41663107162", raoul41663107162, raoul, "Star Citizen", byNc),
  raoul45120650855: shot("45120650855", raoul45120650855, raoul, "Star Citizen", byNc),
  yajih41594388540: shot("41594388540", yajih41594388540, yajih, "StarCitizen 2018-07-12 22-09-53", byNc),
  rellim41638209562: shot("41638209562", rellim41638209562, jonRellim, "[2K] Quantum flower", byNc),
  raoul31241378917: shot("31241378917", raoul31241378917, raoul, "Star Citizen", byNc),
  raoul48340609227: shot("48340609227", raoul48340609227, raoul, "Star Citizen", byNc),
  raoul48408781722: shot("48408781722", raoul48408781722, raoul, "Star Citizen", byNc),
  raoul31867603928: shot("31867603928", raoul31867603928, raoul, "Star Citizen", byNc),
  raoul48695092918: shot("48695092918", raoul48695092918, raoul, "Star Citizen", byNc),
  raoul44402204562: shot("44402204562", raoul44402204562, raoul, "Star Citizen", byNc),
  raoul44799036785: shot("44799036785", raoul44799036785, raoul, "Star Citizen", byNc),
  raoul45014160084: shot("45014160084", raoul45014160084, raoul, "Star Citizen", byNc),
  raoul48325936481: shot("48325936481", raoul48325936481, raoul, "Star Citizen", byNc),
  raoul42971102521: shot("42971102521", raoul42971102521, raoul, "Star Citizen", byNc),
  raoul30441782607: shot("30441782607", raoul30441782607, raoul, "Star Citizen", byNc),
  raoul48494606591: shot("48494606591", raoul48494606591, raoul, "Star Citizen", byNc),
  raoul47272219531: shot("47272219531", raoul47272219531, raoul, "Star Citizen", byNc),
} satisfies Record<string, Shot>;

export type Picture = {
  shot: Shot;
  /** The part of the picture to keep in view when it is cropped, as a CSS position. */
  focus: string;
};

const at = (shot: Shot, focus = "50% 50%"): Picture => ({ shot, focus });

/**
 * The pictures by the place each one fills. To change a picture, put the new
 * file in `pictures/`, add it to `shots` above and point the place at it.
 */
export const pictures = {
  hero: at(shots.raoul48325577926, "50% 50%"),
  intro: at(shots.arieneo48537322302, "40% 50%"),
  why: at(shots.raoul41663107162, "50% 60%"),
  hail: at(shots.raoul45120650855, "50% 55%"),
  work: at(shots.yajih41594388540, "70% 55%"),
  apply: at(shots.rellim41638209562, "50% 50%"),
  standards: at(shots.raoul31241378917, "50% 62%"),
  joining: at(shots.raoul48340609227, "60% 45%"),
  route: at(shots.raoul48408781722, "35% 55%"),
  officers: at(shots.raoul31867603928, "45% 40%"),
  duty: at(shots.raoul48695092918, "55% 45%"),
  members: at(shots.raoul44402204562, "60% 45%"),
  fleet: at(shots.raoul44799036785, "50% 42%"),
  staff: at(shots.raoul45014160084, "50% 40%"),
  ranks: at(shots.raoul47272219531, "50% 38%"),
  lost: at(shots.raoul48325936481, "70% 50%"),
  menuFleet: at(shots.raoul42971102521, "38% 50%"),
  menuJoining: at(shots.raoul30441782607, "42% 50%"),
  menuMembers: at(shots.raoul48494606591, "50% 55%"),
} satisfies Record<string, Picture>;

export type PictureName = keyof typeof pictures;
