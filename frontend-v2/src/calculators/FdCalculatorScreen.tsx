import React, { useMemo, useState } from 'react';

import { CalculatorShell } from '@/src/calculators/CalculatorShell';
import { calcFd, fmtInrFull, fmtRate, fmtYears } from '@/src/calculators/calcMath';

export default function FdCalculatorScreen() {
  const [principal, setPrincipal] = useState(100000);
  const [rate, setRate] = useState(7);
  const [years, setYears] = useState(5);

  const result = useMemo(() => calcFd(principal, rate, years), [principal, rate, years]);

  return (
    <CalculatorShell
      testID="calculator-detail-fd"
      title="FD Calculator"
      result={result}
      investedLabel="Deposit Amount"
      returnsLabel="Interest Earned"
      totalLabel="Maturity Amount"
      sliders={[
        {
          testID: 'fd-principal-slider',
          label: 'Principal Amount',
          value: principal,
          min: 5000,
          max: 1000000,
          step: 5000,
          formatValue: fmtInrFull,
          onChange: setPrincipal,
        },
        {
          testID: 'fd-rate-slider',
          label: 'Interest Rate',
          value: rate,
          min: 1,
          max: 12,
          step: 0.25,
          formatValue: fmtRate,
          onChange: setRate,
        },
        {
          testID: 'fd-years-slider',
          label: 'Tenure',
          value: years,
          min: 1,
          max: 10,
          step: 1,
          formatValue: fmtYears,
          onChange: setYears,
        },
      ]}
    />
  );
}
