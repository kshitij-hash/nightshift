// Every string the check can return, on the page before anyone causes one.
//
// The point of showing the whole vocabulary is that a reader can tell a
// refusal from a bug without triggering it first, and that the string on this
// page, the string in a gate's log and the string in the published package are
// one string.

import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import { REASON_NOTES } from "./reasons";

// Below ~560px the two columns would crush into slivers, so the table keeps
// its width and scrolls inside its own overflow container instead. Evidence
// stays in a table; it does not turn into a stack of cards on a phone.
export function FailureVocabulary() {
  return (
    <Table className="min-w-[560px]">
      <TableHeader>
        <TableRow>
          <TableHead className="w-[240px]">REASON STRING</TableHead>
          <TableHead>WHAT IT MEANS</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {REASON_NOTES.map((n) => (
          <TableRow key={n.reason}>
            {/* The prose column wraps: the shared cell is built for a dense
                numeric row, and a sentence is not one. */}
            {/* At rest a reason string is vocabulary, not a failure: red is
                reserved for the string an actual verdict came back with. */}
            <TableCell
              className="py-2.5 align-top text-[13px] break-all whitespace-normal text-text-default"
              style={{ height: "auto" }}
            >
              {n.reason}
            </TableCell>
            <TableCell
              className="py-2.5 align-top text-[13px] leading-[1.55] whitespace-normal text-text-prose"
              style={{ height: "auto" }}
            >
              {n.meaning}
              {n.fix ? <span className="text-text-caption"> {n.fix}</span> : null}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableCaption>
        The checks run in this order and stop at the first failure, so the string names the first
        thing that was wrong, not every thing. A gate shows the same string the check returned, so
        an operator reading a log and a person reading a screen read the same sentence.
      </TableCaption>
    </Table>
  );
}
