import { root } from "@lynx-js/react";
import { furnituresPictures } from "./assets/furnitures/furnituresPictures.tsx";

import Gallery from "./Gallery.tsx";

function GalleryComplete() {
  return <Gallery pictureData={furnituresPictures} />;
}

root.render(<GalleryComplete />);