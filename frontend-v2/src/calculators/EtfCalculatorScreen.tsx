import React, { useMemo, useState } from 'react';

import { CalculatorShell } from '@/src/calculators/CalculatorShell';
import { calcEtf, fmtInrFull, fmtRate, fmtYears } from '@/src/calculators/calcMath';

export default function EtfCalculatorScreen() {
  const [lumpsum, setLumpsum] = useState(100000);
  const [monthly, setMonthly] = useState(5000);
  const [rate, setRate] = useState(12);
  const [years, setYears] = useState(10);

  const result = useMemo(
    () => calcEtf(lumpsum, monthly, rate, years),
    [lumpsum, monthly, rate, years],
  );

  return (
    <CalculatorShell
      testID="calculator-detail-etf"
      title="ETF Calculator"
      result={result}
      investedLabel="Total Invested"
      returnsLabel="Expected Gains"
      totalLabel="Estimated Value"
      sliders={[
        {
          testID: 'etf-lumpsum-slider',
          label: 'Initial Investment',
          value: lumpsum,
          min: 0,
          max: 1000000,
          step: 5000,
          formatValue: fmtInrFull,
          onChange: setLumpsum,
        },
        {
          testID: 'etf-monthly-slider',
          label: 'Monthly Investment',
          value: monthly,
          min: 0,
          max: 100000,
          step: 500,
          formatValue: fmtInrFull,
          onChange: setMonthly,
        },
        {
          testID: 'etf-rate-slider',
          label: 'Expected Return Rate',
          value: rate,
          min: 1,
          max: 30,
          step: 0.5,
          formatValue: fmtRate,
          onChange: setRate,
        },
        {
          testID: 'etf-years-slider',
          label: 'Investment Period',
          value: years,
          min: 1,
          max: 40,
          step: 1,
          formatValue: fmtYears,
          onChange: setYears,
        },
      ]}
    />
  );
}
