import React, { useMemo, useState } from 'react';

import { CalculatorShell } from '@/src/calculators/CalculatorShell';
import { calcBond, fmtInrFull, fmtRate, fmtYears } from '@/src/calculators/calcMath';

export default function BondCalculatorScreen() {
  const [faceValue, setFaceValue] = useState(100000);
  const [coupon, setCoupon] = useState(7.5);
  const [years, setYears] = useState(10);

  const result = useMemo(() => calcBond(faceValue, coupon, years), [faceValue, coupon, years]);

  return (
    <CalculatorShell
      testID="calculator-detail-bonds"
      title="Bonds Calculator"
      result={result}
      investedLabel="Face Value"
      returnsLabel="Total Coupons"
      totalLabel="Maturity Value"
      sliders={[
        {
          testID: 'bond-face-slider',
          label: 'Face Value / Investment',
          value: faceValue,
          min: 10000,
          max: 1000000,
          step: 5000,
          formatValue: fmtInrFull,
          onChange: setFaceValue,
        },
        {
          testID: 'bond-coupon-slider',
          label: 'Coupon Rate',
          value: coupon,
          min: 1,
          max: 15,
          step: 0.25,
          formatValue: fmtRate,
          onChange: setCoupon,
        },
        {
          testID: 'bond-years-slider',
          label: 'Tenure',
          value: years,
          min: 1,
          max: 30,
          step: 1,
          formatValue: fmtYears,
          onChange: setYears,
        },
      ]}
    />
  );
}
