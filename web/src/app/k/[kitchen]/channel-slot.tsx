"use client";

/**
 * THE PLACE FOR INPUT CHANNELS in the assistant panel: a microphone button and an "add a photo or document"
 * button mount here, next to the field and the Send button. Built separately under web/src/app/_channels/
 * (routes /ui-api/voice and /ui-api/scan). Render small square buttons (min 44 px); hand recognised text to
 * `onText` (it fills the field) or `onSubmit` (it sends it as if typed). Renders nothing until they exist.
 */
export type ChannelSlotProps = {
  kitchen: string;
  onText: (text: string) => void;
  onSubmit: (text: string) => void;
  disabled?: boolean;
  /** Speech recognition language for the buyer's chosen product-name language: en-GB, fi-FI or sv-SE. */
  lang: string;
};

export function ChannelSlot(props: ChannelSlotProps) {
  void props;
  return null;
}
