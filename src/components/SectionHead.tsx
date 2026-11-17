/**
 * The head every section after the hero opens with: the yellow eyebrow, the section's only `<h2>`
 * and, when it has one, the lead under it. `titleId` is the `<h2>`'s id, for a section that is
 * named by its title (`aria-labelledby`), as the design names its sections.
 */
export function SectionHead(props: {
  eyebrow: string;
  title: string;
  lead?: string;
  titleId?: string;
}) {
  const { eyebrow, title, lead, titleId } = props;
  return (
    <div className="section-head">
      <p className="eyebrow">{eyebrow}</p>
      <h2 id={titleId}>{title}</h2>
      {lead === undefined ? null : <p className="section-lead">{lead}</p>}
    </div>
  );
}
