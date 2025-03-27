import LikeImageCard from "./components/LikeImageCard.jsx";
import { furnituresPictures, type Picture } from "./furnituresPictures.jsx";
import { calculateEstimatedSize } from "./utils.jsx";

export const Gallery = () => {
  return (
    <view className="gallery-wrapper">
      <list
        className="list"
        list-type="waterfall"
        column-count={2}
        scroll-orientation="vertical"
        custom-list-name="list-container"
      >
        {furnituresPictures.map((picture: Picture, index: number) => (
          <list-item
            estimated-main-axis-size-px={calculateEstimatedSize(picture.width, picture.height)}
            item-key={"" + index}
            key={"" + index}
          >
            <LikeImageCard picture={picture} />
          </list-item>
        ))}
      </list>
    </view>
  );
};

export default Gallery;