import { Composition, Still } from "remotion";
import { Demo, DEMO_TOTAL, DemoCaptions } from "./demo/Demo";
import { Film } from "./Film";
import { StyleAgents, StyleAiven, StyleGate, StyleSearch } from "./Style";
import { TOTAL } from "./timing";

export const RemotionRoot = () => {
  return (
    <>
      <Composition id="Film" component={Film} durationInFrames={TOTAL} fps={30} width={1920} height={1080} />
      <Composition id="Demo" component={Demo} durationInFrames={DEMO_TOTAL} fps={30} width={1920} height={1080} />
      <Composition id="DemoCaptions" component={DemoCaptions} durationInFrames={DEMO_TOTAL} fps={30} width={1920} height={1080} />
      <Still id="StyleSearch" component={StyleSearch} width={1920} height={1080} />
      <Still id="StyleGate" component={StyleGate} width={1920} height={1080} />
      <Still id="StyleAgents" component={StyleAgents} width={1920} height={1080} />
      <Still id="StyleAiven" component={StyleAiven} width={1920} height={1080} />
    </>
  );
};
