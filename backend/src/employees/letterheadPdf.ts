// Background stacks need an explicit column width: a stack's own `width`
// does not constrain right-aligned text in pdfmake.
export function boundedLetterheadBlock(stack: object[], width: number, x: number, y: number) {
  return { columns: [{ width, stack }], columnGap: 0, absolutePosition: { x, y } };
}
