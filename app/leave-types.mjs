export const leaveKinds = ['annual', 'social', 'sick', 'maternity', 'childcare']

export function movesWorkingYear(kind) {
  return kind === 'social' || kind === 'childcare'
}

export function interruptsVacation(kind) {
  return kind === 'sick' || kind === 'maternity'
}
