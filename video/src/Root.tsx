import { Composition } from "remotion";
import { Film } from "./Film";
import { TOTAL } from "./timing";

export const RemotionRoot = () => {
  return (
    <>
      <Composition id="Film" component={Film} durationInFrames={TOTAL} fps={30} width={1920} height={1080} />
    </>
  );
};
