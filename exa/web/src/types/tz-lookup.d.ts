declare module "tz-lookup" {
  /** The IANA time zone at these coordinates, for example "Europe/Helsinki". Throws on invalid input. */
  export default function tzlookup(latitude: number, longitude: number): string;
}
