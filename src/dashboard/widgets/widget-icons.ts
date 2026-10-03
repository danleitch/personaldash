import {
  CalendarClock,
  CalendarDays,
  Clock,
  CloudSun,
  GitPullRequest,
  Newspaper,
  Star,
  Timer,
  TrendingUp,
  Trophy,
  Tv,
  type LucideIcon
} from 'lucide-react';
import type { WidgetType } from '../lib/model';

/** Each widget's symbol, in the picker and its settings. */
export const WIDGET_ICONS: Readonly<Record<WidgetType, LucideIcon>> = {
  weather: CloudSun,
  markets: TrendingUp,
  clock: Clock,
  focus: Timer,
  calendar: CalendarDays,
  agenda: CalendarClock,
  hackernews: Newspaper,
  github: Star,
  prs: GitPullRequest,
  benchlm: Trophy,
  tv: Tv
};
