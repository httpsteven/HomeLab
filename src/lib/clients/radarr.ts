import "server-only";
import { ArrClient } from "./arr";
import { qs } from "@/lib/http";

export interface MediaInfo {
  videoCodec?: string;
  videoDynamicRange?: string;
  videoDynamicRangeType?: string;
  audioCodec?: string;
  audioChannels?: number;
  resolution?: string;
  runTime?: string;
  videoBitDepth?: number;
}

export interface MovieFile {
  id: number;
  relativePath?: string;
  path?: string;
  size: number;
  dateAdded?: string;
  quality?: { quality?: { id: number; name: string; resolution?: number } };
  mediaInfo?: MediaInfo;
}

export interface Movie {
  id: number;
  title: string;
  sortTitle?: string;
  year?: number;
  status: string;
  monitored: boolean;
  hasFile: boolean;
  runtime?: number;
  qualityProfileId: number;
  sizeOnDisk: number;
  path: string;
  rootFolderPath?: string;
  added?: string;
  movieFile?: MovieFile;
  images?: { coverType: string; remoteUrl?: string; url?: string }[];
  ratings?: { imdb?: { value?: number }; tmdb?: { value?: number } };
  genres?: string[];
  studio?: string;
}

export class RadarrClient extends ArrClient {
  constructor() {
    super("radarr");
  }

  movies() {
    return this.call<Movie[]>("/movie");
  }

  calendar(start: Date, end: Date) {
    return this.call<
      {
        id: number;
        title: string;
        year?: number;
        inCinemas?: string;
        physicalRelease?: string;
        digitalRelease?: string;
        hasFile: boolean;
      }[]
    >(`/calendar${qs({ start: start.toISOString(), end: end.toISOString() })}`);
  }

  history(pageSize = 30) {
    return this.call<{
      records: {
        id: number;
        eventType: string;
        date: string;
        sourceTitle: string;
        movieId: number;
      }[];
    }>(`/history${qs({ pageSize, sortKey: "date", sortDirection: "descending" })}`);
  }
}

export const radarr = new RadarrClient();
