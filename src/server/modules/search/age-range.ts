/**
 * B4 §20: age search is always a date-of-birth range query at the
 * database level — age itself is never stored (see profiles/completion.ts
 * computeAge), so "minAge/maxAge" has to be converted into DOB bounds
 * before it can be used in a WHERE clause. Kept as its own small module
 * rather than added to profiles/completion.ts, so B4 introduces zero
 * changes to that frozen B3 file.
 *
 * Definition (must match completion.ts's computeAge exactly, or a profile
 * could compute as one age but search as another): a person is `age`
 * years old from their birthday up to (not including) their next
 * birthday. So "at least minAge" means "born on or before (today - minAge
 * years)", and "at most maxAge" means "born on or after (today - (maxAge
 * + 1) years) + 1 day" — i.e. anyone who has already had their maxAge-th
 * birthday but not their (maxAge+1)-th.
 */

/** Returns the inclusive [minDob, maxDob] a profile's dateOfBirth must
 * fall within to satisfy `minAge <= age <= maxAge` as of `asOf`. Either
 * bound may be omitted (undefined) if the corresponding filter wasn't
 * supplied. */
export function dobBoundsForAgeRange(
  minAge: number | undefined,
  maxAge: number | undefined,
  asOf: Date = new Date()
): { minDob?: Date; maxDob?: Date } {
  const bounds: { minDob?: Date; maxDob?: Date } = {};

  // age >= minAge  <=>  dateOfBirth <= (asOf - minAge years)
  if (minAge !== undefined) {
    const d = new Date(asOf);
    d.setFullYear(d.getFullYear() - minAge);
    bounds.maxDob = d;
  }

  // age <= maxAge  <=>  dateOfBirth >= (asOf - (maxAge + 1) years) + 1 day
  if (maxAge !== undefined) {
    const d = new Date(asOf);
    d.setFullYear(d.getFullYear() - (maxAge + 1));
    d.setDate(d.getDate() + 1);
    bounds.minDob = d;
  }

  return bounds;
}
