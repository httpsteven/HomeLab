import "server-only";
import { ArrClient } from "./arr";
import { qs } from "@/lib/http";

export interface SeriesStatistics {
  seasonCount: number;
  episodeFileCount: number;
  episodeCount: number;
  totalEpisodeCount: number;
  sizeOnDisk: number;
  percentOfEpisodes: number;
}

export interface Series {
  id: number;
  title: string;
  sortTitle?: string;
  status: string;
  ended?: boolean;
  year?: number;
  network?: string;
  runtime?: number;
  monitored: boolean;
  qualityProfileId: number;
  rootFolderPath?: string;
  path: string;
  added?: string;
  seriesType?: string;
  statistics?: SeriesStatistics;
  images?: { coverType: string; remoteUrl?: string; url?: string }[];
  ratings?: { value?: number; votes?: number };
  genres?: string[];
}

export interface WantedMissing {
  page: number;
  totalRecords: number;
  records: { id: number; seriesId: number; title: string; airDateUtc?: string }[];
}

export class SonarrClient extends ArrClient {
  constructor() {
    super("sonarr");
  }

  series() {
    return this.call<Series[]>("/series");
  }

  /** Missing episodes that have already aired. */
  wantedMissing(pageSize = 50) {
    return this.call<WantedMissing>(
      `/wanted/missing${qs({ pageSize, sortKey: "airDateUtc", sortDirection: "descending" })}`,
    );
  }

  calendar(start: Date, end: Date) {
    return this.call<
      {
        id: number;
        seriesId: number;
        title: string;
        airDateUtc: string;
        seasonNumber: number;
        episodeNumber: number;
        hasFile: boolean;
        series?: { title: string };
      }[]
    >(`/calendar${qs({ start: start.toISOString(), end: end.toISOString(), includeSeries: true })}`);
  }

  history(pageSize = 30) {
    return this.call<{
      records: {
        id: number;
        eventType: string;
        date: string;
        sourceTitle: string;
        seriesId: number;
      }[];
    }>(`/history${qs({ pageSize, sortKey: "date", sortDirection: "descending" })}`);
  }
}

export const sonarr = new SonarrClient();
