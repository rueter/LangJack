/**
 * Dependency Visualizer: Generates interactive SVG dependency arc trees
 * for Universal Dependencies (UD) sentence presentations.
 * Draws:
 * 1. Horizontal token nodes with ID, FORM, LEMMA, and UPOS badges.
 * 2. Directed bezier arcs connecting HEAD tokens to Dependent tokens.
 * 3. Prominent ROOT arrow for head=0.
 * 4. Centered relation pills displaying DEPREL labels.
 * 5. Interactive click-to-connect and arc selection for in-UI dependency editing.
 */

export const UPOS_COLORS = {
  NOUN: '#0284c7',   // Sky Blue
  PROPN: '#0369a1',  // Deep Blue
  PRON: '#0284c7',   // Sky Blue
  VERB: '#16a34a',   // Emerald Green
  AUX: '#059669',    // Teal Green
  ADJ: '#9333ea',    // Purple
  ADV: '#d97706',    // Amber
  ADP: '#ea580c',    // Orange
  CCONJ: '#0891b2',  // Cyan
  SCONJ: '#0891b2',  // Cyan
  DET: '#8b5cf6',    // Violet
  NUM: '#ca8a04',    // Gold
  PART: '#dc2626',   // Red
  INTJ: '#db2777',   // Pink
  SYM: '#64748b',    // Slate
  PUNCT: '#94a3b8',  // Light Gray
  X: '#64748b'       // Slate
};

export class DependencyVisualizer {
  /**
   * Generates standalone SVG markup representing the dependency tree of a sentence.
   * @param {Array<Object>} tokens - Tokens array with id, form, lemma, upos, head, deprel
   * @param {Object} options - Customization options
   * @returns {string} SVG markup string
   */
  static renderSvg(tokens, options = {}) {
    if (!Array.isArray(tokens) || tokens.length === 0) {
      return '<svg width="100%" height="80"><text x="50%" y="50%" text-anchor="middle" fill="#94a3b8">No tokens to visualize.</text></svg>';
    }

    const tokenSpacing = options.tokenSpacing || 130;
    const tokenWidth = 100;
    const paddingX = 70;
    const totalTokens = tokens.length;
    const totalWidth = Math.max(760, paddingX * 2 + (totalTokens - 1) * tokenSpacing + tokenWidth);

    // Compute token horizontal center coordinates
    const positions = new Map();
    tokens.forEach((tok, idx) => {
      const id = tok.id || (idx + 1);
      const cx = paddingX + idx * tokenSpacing + tokenWidth / 2;
      positions.set(id, cx);
    });

    // Calculate maximum arc distance to determine required SVG height
    let maxDist = 1;
    tokens.forEach(tok => {
      if (tok.head !== undefined && tok.head !== null && tok.head !== '' && tok.head !== '_') {
        const headId = Number(tok.head);
        if (headId > 0) {
          const d = Math.abs(headId - tok.id);
          if (d > maxDist) maxDist = d;
        }
      }
    });

    const maxArcHeight = Math.min(220, 50 + maxDist * 32);
    const baselineY = maxArcHeight + 35; // Y position where arcs touch token heads
    const totalHeight = baselineY + 120; // Room for tokens underneath

    const svgParts = [];

    // 1. Defs: Arrowhead markers
    svgParts.push(`
      <defs>
        <marker id="dep-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 10 5 L 0 8.5 z" fill="#475569"/>
        </marker>
        <marker id="dep-arrow-root" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 1.5 L 10 5 L 0 8.5 z" fill="#dc2626"/>
        </marker>
        <marker id="dep-arrow-selected" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 1.5 L 10 5 L 0 8.5 z" fill="#0284c7"/>
        </marker>
        <filter id="badge-shadow" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="0" dy="1" stdDeviation="1" flood-color="#000" flood-opacity="0.12"/>
        </filter>
      </defs>
    `);

    // 2. Baseline guide rule
    svgParts.push(`<line x1="${paddingX - 30}" y1="${baselineY}" x2="${totalWidth - paddingX + 30}" y2="${baselineY}" stroke="#e2e8f0" stroke-width="1.5" stroke-dasharray="4,4"/>`);

    // 3. Dependency Arcs
    tokens.forEach((tok, idx) => {
      const depId = tok.id || (idx + 1);
      const depX = positions.get(depId);
      const rawHead = tok.head;

      if (rawHead === undefined || rawHead === null || rawHead === '' || rawHead === '_') {
        return; // No head annotated
      }

      const headId = Number(rawHead);
      const deprel = tok.deprel || 'dep';
      const isSelected = options.selectedTokenId === depId;

      if (headId === 0) {
        // Root token: vertical line coming down from top
        const rootY = baselineY - Math.min(80, maxArcHeight * 0.7);
        const strokeColor = isSelected ? '#0284c7' : '#dc2626';
        const marker = isSelected ? 'url(#dep-arrow-selected)' : 'url(#dep-arrow-root)';

        svgParts.push(`
          <g class="dep-arc dep-arc-root" data-dep-id="${depId}">
            <line x1="${depX}" y1="${rootY}" x2="${depX}" y2="${baselineY - 2}" stroke="${strokeColor}" stroke-width="${isSelected ? 2.5 : 2}" marker-end="${marker}"/>
            <circle cx="${depX}" cy="${rootY}" r="4" fill="${strokeColor}"/>
            <!-- Root Label Badge -->
            <g class="deprel-badge" transform="translate(${depX}, ${(rootY + baselineY) / 2})">
              <rect x="-24" y="-10" width="48" height="20" rx="4" fill="#fee2e2" stroke="#fca5a5" stroke-width="1" filter="url(#badge-shadow)"/>
              <text x="0" y="3.5" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="11" font-weight="700" fill="#991b1b" text-anchor="middle">root</text>
            </g>
          </g>
        `);
      } else if (positions.has(headId) && headId !== depId) {
        // Regular head -> dependent arc
        const headX = positions.get(headId);
        const dist = Math.abs(headId - depId);
        const arcHeight = Math.min(maxArcHeight, 35 + dist * 28);
        const peakY = baselineY - arcHeight;
        const midX = (headX + depX) / 2;

        const isLeftToRight = headX < depX;
        const strokeColor = isSelected ? '#0284c7' : '#475569';
        const marker = isSelected ? 'url(#dep-arrow-selected)' : 'url(#dep-arrow)';

        // Cubic bezier curve path
        const pathData = `M ${headX} ${baselineY} C ${headX} ${peakY}, ${depX} ${peakY}, ${depX} ${baselineY - 3}`;

        // Badge pill size based on deprel length
        const badgeWidth = Math.max(46, deprel.length * 7.5 + 16);

        svgParts.push(`
          <g class="dep-arc" data-dep-id="${depId}" data-head-id="${headId}">
            <path d="${pathData}" fill="none" stroke="${strokeColor}" stroke-width="${isSelected ? 2.5 : 1.75}" marker-end="${marker}"/>
            <!-- Deprel Badge -->
            <g class="deprel-badge" data-dep-id="${depId}" transform="translate(${midX}, ${peakY})" style="cursor: pointer;">
              <rect x="${-badgeWidth / 2}" y="-10" width="${badgeWidth}" height="20" rx="4" fill="#ffffff" stroke="${strokeColor}" stroke-width="1.2" filter="url(#badge-shadow)"/>
              <text x="0" y="3.5" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="11" font-weight="600" fill="${strokeColor}" text-anchor="middle">${deprel}</text>
            </g>
          </g>
        `);
      }
    });

    // 4. Token Cards below the baseline
    tokens.forEach((tok, idx) => {
      const id = tok.id || (idx + 1);
      const cx = positions.get(id);
      const cardX = cx - tokenWidth / 2;
      const cardY = baselineY + 12;
      const isSelected = options.selectedTokenId === id;

      const form = tok.form || '';
      const lemma = tok.lemma || (tok.selectedReading ? tok.selectedReading.lemma : form);
      const upos = (tok.upos || 'X').toUpperCase();
      const uposColor = UPOS_COLORS[upos] || '#64748b';

      const strokeBorder = isSelected ? '#0284c7' : '#cbd5e1';
      const bgCard = isSelected ? '#f0f9ff' : '#ffffff';

      svgParts.push(`
        <g class="dep-token-card" data-token-id="${id}" transform="translate(${cardX}, ${cardY})" style="cursor: pointer;">
          <!-- Card Container -->
          <rect x="0" y="0" width="${tokenWidth}" height="84" rx="6" fill="${bgCard}" stroke="${strokeBorder}" stroke-width="${isSelected ? 2 : 1}" filter="url(#badge-shadow)"/>
          
          <!-- Token ID Tag -->
          <rect x="6" y="6" width="20" height="15" rx="3" fill="#f1f5f9"/>
          <text x="16" y="17" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="9" font-weight="700" fill="#64748b" text-anchor="middle">${id}</text>
          
          <!-- UPOS Badge -->
          <rect x="${tokenWidth - 48}" y="6" width="42" height="15" rx="3" fill="${uposColor}18" stroke="${uposColor}" stroke-width="0.8"/>
          <text x="${tokenWidth - 27}" y="17" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="9" font-weight="700" fill="${uposColor}" text-anchor="middle">${upos}</text>
          
          <!-- Word Form -->
          <text x="${tokenWidth / 2}" y="42" font-family="Charis SIL, DejaVu Sans, sans-serif" font-size="14" font-weight="700" fill="#0f172a" text-anchor="middle">${escapeXml(form)}</text>
          
          <!-- Lemma -->
          <text x="${tokenWidth / 2}" y="58" font-family="Charis SIL, DejaVu Sans, sans-serif" font-size="11" font-style="italic" fill="#64748b" text-anchor="middle">${escapeXml(lemma)}</text>
          
          <!-- Head / Deprel Footer Pill -->
          <line x1="6" y1="66" x2="${tokenWidth - 6}" y2="66" stroke="#f1f5f9" stroke-width="1"/>
          <text x="${tokenWidth / 2}" y="77" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="9.5" font-weight="600" fill="#475569" text-anchor="middle">
            ${tok.head !== undefined && tok.head !== null && tok.head !== '' && tok.head !== '_' ? (tok.head === 0 ? 'ROOT' : `→ ${tok.head} (${tok.deprel || 'dep'})`) : 'no head'}
          </text>
        </g>
      `);
    });

    return `
      <svg class="dependency-tree-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${totalHeight}" width="${totalWidth}" height="${totalHeight}">
        ${svgParts.join('\n')}
      </svg>
    `;
  }
}

function escapeXml(unsafe) {
  if (!unsafe) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
