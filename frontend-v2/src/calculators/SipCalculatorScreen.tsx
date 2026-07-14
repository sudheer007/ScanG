import React, { useMemo, useState } from 'react';

import { CalculatorShell } from '@/src/calculators/CalculatorShell';
import { calcSip, fmtInrFull, fmtRate, fmtYears } from '@/src/calculators/calcMath';

export default function SipCalculatorScreen() {
  const [monthly, setMonthly] = useState(5000);
  const [rate, setRate] = useState(12);
  const [years, setYears] = useState(10);

  const result = useMemo(() => calcSip(monthly, rate, years), [monthly, rate, years]);

  return (
    <CalculatorShell
      testID="calculator-detail-sip"
      title="SIP Calculator"
      result={result}
      sliders={[
        {
          testID: 'sip-monthly-slider',
          label: 'Monthly Investment',
          value: monthly,
          min: 500,
          max: 100000,
          step: 500,
          formatValue: fmtInrFull,
          onChange: setMonthly,
        },
        {
          testID: 'sip-rate-slider',
          label: 'Expected Return Rate',
          value: rate,
          min: 1,
          max: 30,
          step: 0.5,
          formatValue: fmtRate,
          onChange: setRate,
        },
        {
          testID: 'sip-years-slider',
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
