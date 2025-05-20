import pic0 from "@assets/furnitures/0.png?inline";
import pic1 from "@assets/furnitures/1.png?inline";
import pic10 from "@assets/furnitures/10.png?inline";
import pic11 from "@assets/furnitures/11.png?inline";
import pic12 from "@assets/furnitures/12.png?inline";
import pic13 from "@assets/furnitures/13.png?inline";
import pic14 from "@assets/furnitures/14.png?inline";
import pic2 from "@assets/furnitures/2.png?inline";
import pic3 from "@assets/furnitures/3.png?inline";
import pic4 from "@assets/furnitures/4.png?inline";
import pic5 from "@assets/furnitures/5.png?inline";
import pic6 from "@assets/furnitures/6.png?inline";
import pic7 from "@assets/furnitures/7.png?inline";
import pic8 from "@assets/furnitures/8.png?inline";
import pic9 from "@assets/furnitures/9.png?inline";

export interface Picture {
  src: string;
  width: number;
  height: number;
}

export const furnituresPicturesSubArray: Picture[] = [
  {
    src: pic0,
    width: 512,
    height: 429,
  },
  {
    src: pic1,
    width: 511,
    height: 437,
  },
  {
    src: pic2,
    width: 1024,
    height: 1589,
  },
  {
    src: pic3,
    width: 510,
    height: 418,
  },
  {
    src: pic4,
    width: 509,
    height: 438,
  },
  {
    src: pic5,
    width: 1024,
    height: 1557,
  },
  {
    src: pic6,
    width: 509,
    height: 415,
  },
  {
    src: pic7,
    width: 509,
    height: 426,
  },
  {
    src: pic8,
    width: 1024,
    height: 1544,
  },
  {
    src: pic9,
    width: 510,
    height: 432,
  },
  {
    src: pic10,
    width: 1024,
    height: 1467,
  },
  {
    src: pic11,
    width: 1024,
    height: 1545,
  },
  {
    src: pic12,
    width: 512,
    height: 416,
  },
  {
    src: pic13,
    width: 1024,
    height: 1509,
  },
  {
    src: pic14,
    width: 512,
    height: 411,
  },
];

export const furnituresPictures: Picture[] = [
  ...furnituresPicturesSubArray,
  ...furnituresPicturesSubArray,
  ...furnituresPicturesSubArray,
  ...furnituresPicturesSubArray,
  ...furnituresPicturesSubArray,
];
