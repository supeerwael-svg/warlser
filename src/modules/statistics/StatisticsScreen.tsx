import { useMemo, useState } from 'react';
import { Download, Printer, Users, UserRound, UsersRound, Home } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/StatusBlock';
import { FilterChip } from '@/components/ui/FilterChip';
import { loadStudentWorkspace } from '@/db/students';
import { useSession } from '@/modules/auth/AuthContext';
import { StatisticsCharts } from '@/modules/statistics/StatisticsCharts';
import { errorKey } from '@/utils/errors';
import { todayIso } from '@/utils/dates';
import { exportRowsToExcel } from '@/utils/spreadsheet';
import { printReport } from '@/utils/printReport';
import { buildClassStatistics, sumClassStatistics, type ClassStatistics, type GenderCounts } from '@/utils/statistics';
import { CLASS_LEVELS } from '@/utils/classLevel';
import { useAsyncData } from '@/utils/useAsyncData';

type LevelFilter = 'all' | 1 | 2 | 3 | 4;

interface LevelGroup {
  level: number | null;
  label: string;
  classes: ClassStatistics[];
  subtotal: ReturnType<typeof sumClassStatistics>;
}

export function StatisticsScreen() {
  const { t, i18n } = useTranslation();
  const { user, institution } = useSession();
  const workspace = useAsyncData(() => loadStudentWorkspace(institution.id, user.id), [institution.id, user.id]);
  const today = todayIso();
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all');

  const data = workspace.data;
  const isHead = data?.access.isHead ?? false;
  const allStats = useMemo(
    () => (data ? buildClassStatistics(data.classes, data.students, today) : []),
    [data, today],
  );

  const levelGroups = useMemo(() => groupByLevel(allStats, t), [allStats, t]);
  const filteredGroups = useMemo(
    () => (levelFilter === 'all' ? levelGroups : levelGroups.filter((g) => g.level === levelFilter)),
    [levelGroups, levelFilter],
  );
  const filteredStats = useMemo(
    () => filteredGroups.flatMap((g) => g.classes),
    [filteredGroups],
  );
  const totals = useMemo(() => sumClassStatistics(filteredStats), [filteredStats]);

  const reportHeaders = [
    t('statistics.classColumn'),
    t('statistics.boysColumn'),
    t('statistics.girlsColumn'),
    t('statistics.totalColumn'),
    t('statistics.halfBoysColumn'),
    t('statistics.halfGirlsColumn'),
    t('statistics.halfBoardersColumn'),
  ];

  const buildReportRows = (): (string | number)[][] => {
    const rows: (string | number)[][] = [];
    for (const group of filteredGroups) {
      for (const row of group.classes) {
        rows.push(statRowValues(row.name, row));
      }
      rows.push([
        t('statistics.sublevelTotal', { level: levelLabel(group.level, t) }),
        group.subtotal.students.boys,
        group.subtotal.students.girls,
        group.subtotal.students.total,
        group.subtotal.halfBoarders.boys,
        group.subtotal.halfBoarders.girls,
        group.subtotal.halfBoarders.total,
      ]);
    }
    rows.push([
      t('statistics.grandTotal'),
      totals.students.boys,
      totals.students.girls,
      totals.students.total,
      totals.halfBoarders.boys,
      totals.halfBoarders.girls,
      totals.halfBoarders.total,
    ]);
    return rows;
  };

  const handleExcel = () => {
    const rows = buildReportRows().map((values) =>
      Object.fromEntries(reportHeaders.map((header, index) => [header, values[index]])) as Record<string, string | number>,
    );
    exportRowsToExcel(rows, t('statistics.title'), 'student-statistics.xlsx');
  };

  const handlePrint = () => {
    const rows = buildReportRows();
    const footer = rows[rows.length - 1].map(String);
    printReport({
      title: t('statistics.reportTitle'),
      subtitle: t('statistics.reportSubtitle', { date: today }),
      lang: i18n.language,
      dir: i18n.dir(),
      sections: [
        {
          heading: null,
          headers: reportHeaders,
          rows: rows.slice(0, -1).map((values) => values.map(String)),
          footer,
        },
      ],
    });
  };

  const filterOptions: { value: LevelFilter; label: string }[] = [
    { value: 'all', label: t('statistics.levelFilterAll') },
    ...CLASS_LEVELS.map((level) => ({
      value: level as LevelFilter,
      label: t(`statistics.levelShort.${level}`),
    })),
  ];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl text-neutral-900">{t('statistics.title')}</h1>
          <p className="text-base text-neutral-600">{t('statistics.subtitle')}</p>
        </div>
      </header>

      {workspace.loading && !data ? (
        <LoadingState />
      ) : workspace.error ? (
        <ErrorState message={t(errorKey(workspace.error))} onRetry={workspace.reload} />
      ) : allStats.length === 0 ? (
        <EmptyState icon={<Users className="size-7" aria-hidden />} title={t('statistics.empty')} body={t('statistics.scopeTotals')} />
      ) : (
        <>
          <p className="text-sm font-medium text-primary-700">
            {isHead ? t('statistics.institutionTotals') : t('statistics.scopeTotals')}
          </p>

          <section className="grid grid-cols-2 gap-3">
            <SummaryCard icon={<Users className="size-5" aria-hidden />} label={t('statistics.summaryStudents')} value={totals.students.total} tone="primary" />
            <SummaryCard icon={<UserRound className="size-5" aria-hidden />} label={t('statistics.summaryBoys')} value={totals.students.boys} tone="secondary" />
            <SummaryCard icon={<UsersRound className="size-5" aria-hidden />} label={t('statistics.summaryGirls')} value={totals.students.girls} tone="accent" />
            <SummaryCard icon={<Home className="size-5" aria-hidden />} label={t('statistics.summaryHalfBoarders')} value={totals.halfBoarders.total} tone="success" />
          </section>

          <div className="flex flex-wrap gap-2">
            {filterOptions.map((opt) => (
              <FilterChip
                key={String(opt.value)}
                label={opt.label}
                active={levelFilter === opt.value}
                onClick={() => setLevelFilter(opt.value)}
              />
            ))}
          </div>

          <StatisticsCharts rows={filteredStats} />

          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-neutral-900">{t('statistics.perClass')}</h2>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={handleExcel} icon={<Download className="size-4" aria-hidden />}>
                  {t('statistics.exportExcel')}
                </Button>
                <Button variant="secondary" onClick={handlePrint} icon={<Printer className="size-4" aria-hidden />}>
                  {t('statistics.exportPdf')}
                </Button>
              </div>
            </div>

            {filteredGroups.map((group) => (
              <div key={String(group.level)} className="flex flex-col gap-2">
                <div className="flex items-center gap-2 px-1">
                  <h3 className="text-base font-bold text-neutral-800">{group.label}</h3>
                  <span className="rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">
                    {t('statistics.classesCount', { count: group.classes.length })}
                  </span>
                </div>
                <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-neutral-200">
                  <table className="w-full min-w-[40rem] text-sm">
                    <thead className="bg-neutral-50 text-neutral-600">
                      <tr>
                        {reportHeaders.map((header, index) => (
                          <th key={header} className={`px-4 py-3 font-semibold ${index === 0 ? 'text-start' : 'text-end'}`}>
                            {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {group.classes.map((row) => (
                        <tr key={row.classId} className="transition hover:bg-neutral-50">
                          {statRowValues(row.name, row).map((value, index) => (
                            <td key={index} className={`px-4 py-3 text-neutral-900 ${index === 0 ? 'font-medium text-start' : 'text-end tabular-nums'}`}>
                              {value}
                            </td>
                          ))}
                        </tr>
                      ))}
                      <tr className="border-t-2 border-neutral-200 bg-neutral-50 font-bold text-neutral-900">
                        <td className="px-4 py-3 text-start">{t('statistics.sublevelTotal', { level: group.label })}</td>
                        <td className="px-4 py-3 text-end tabular-nums">{group.subtotal.students.boys}</td>
                        <td className="px-4 py-3 text-end tabular-nums">{group.subtotal.students.girls}</td>
                        <td className="px-4 py-3 text-end tabular-nums">{group.subtotal.students.total}</td>
                        <td className="px-4 py-3 text-end tabular-nums">{group.subtotal.halfBoarders.boys}</td>
                        <td className="px-4 py-3 text-end tabular-nums">{group.subtotal.halfBoarders.girls}</td>
                        <td className="px-4 py-3 text-end tabular-nums">{group.subtotal.halfBoarders.total}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            ))}

            {filteredGroups.length > 0 && (
              <div className="overflow-x-auto rounded-2xl bg-primary-50 ring-1 ring-primary-200">
                <table className="w-full min-w-[40rem] text-sm font-bold text-neutral-900">
                  <tbody>
                    <tr>
                      <td className="px-4 py-3 text-start">{t('statistics.grandTotal')}</td>
                      <td className="px-4 py-3 text-end tabular-nums">{totals.students.boys}</td>
                      <td className="px-4 py-3 text-end tabular-nums">{totals.students.girls}</td>
                      <td className="px-4 py-3 text-end tabular-nums">{totals.students.total}</td>
                      <td className="px-4 py-3 text-end tabular-nums">{totals.halfBoarders.boys}</td>
                      <td className="px-4 py-3 text-end tabular-nums">{totals.halfBoarders.girls}</td>
                      <td className="px-4 py-3 text-end tabular-nums">{totals.halfBoarders.total}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function groupByLevel(stats: ClassStatistics[], t: (key: string, opts?: Record<string, unknown>) => string): LevelGroup[] {
  const groups: LevelGroup[] = [];
  for (const level of CLASS_LEVELS) {
    const classes = stats.filter((s) => s.level === level);
    if (classes.length === 0) continue;
    groups.push({
      level,
      label: levelLabel(level, t),
      classes,
      subtotal: sumClassStatistics(classes),
    });
  }
  const unclassified = stats.filter((s) => s.level === null);
  if (unclassified.length > 0) {
    groups.push({
      level: null,
      label: t('statistics.unclassified'),
      classes: unclassified,
      subtotal: sumClassStatistics(unclassified),
    });
  }
  return groups;
}

function levelLabel(level: number | null, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (level === null) return t('statistics.unclassified');
  return t(`statistics.levelNames.${level}`);
}

function statRowValues(name: string, row: ClassStatistics): (string | number)[] {
  return [name, ...countValues(row.students), ...countValues(row.halfBoarders).slice(0, 0), row.halfBoarders.boys, row.halfBoarders.girls, row.halfBoarders.total];
}

function countValues(counts: GenderCounts): number[] {
  return [counts.boys, counts.girls, counts.total];
}

const TONE_CLASSES = {
  primary: 'bg-primary-50 text-primary-700',
  secondary: 'bg-secondary-50 text-secondary-700',
  accent: 'bg-accent-50 text-accent-700',
  success: 'bg-success-50 text-success-700',
} as const;

function SummaryCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: keyof typeof TONE_CLASSES;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-neutral-200 transition hover:-translate-y-0.5 hover:shadow-md">
      <span className={`flex size-10 items-center justify-center rounded-xl ${TONE_CLASSES[tone]}`}>{icon}</span>
      <span className="text-sm text-neutral-600">{label}</span>
      <span className="text-2xl font-bold tabular-nums text-neutral-900">{value}</span>
    </div>
  );
}
