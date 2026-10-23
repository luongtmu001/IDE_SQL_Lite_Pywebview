/**
 * candidate-filter.js - Multi-Stage IntelliSense Candidate Filter
 */
(function(window) {
    'use strict';

    class CandidateFilter {
        constructor(options = {}) {
            this.fuzzyThreshold = options.fuzzyThreshold || 2; // Min chars to activate fuzzy search
            this.maxPrefixToSkipFuzzy = options.maxPrefixToSkipFuzzy || 8; // If prefix matches >= 8, skip fuzzy to avoid noise
        }

        static splitSubWords(candidateName) {
            if (!candidateName || typeof candidateName !== 'string') return [];
            let clean = candidateName.trim();
            // Strip surrounding quotes or brackets
            if ((clean.startsWith('[') && clean.endsWith(']')) ||
                (clean.startsWith('"') && clean.endsWith('"')) ||
                (clean.startsWith('`') && clean.endsWith('`'))) {
                clean = clean.substring(1, clean.length - 1);
            }
            // Strip leading # or @
            clean = clean.replace(/^[#@]+/, '');
            if (!clean) return [];

            // Normalize Unicode (NFC) per Spec 11.2
            try {
                clean = clean.normalize('NFC');
            } catch (_) {}

            // Split by punctuation / separators: underscores, hyphens, spaces, dots
            const chunks = clean.split(/[-_\s.]+/).filter(Boolean);
            const subWords = [];

            for (const chunk of chunks) {
                // Split camelCase, PascalCase, and Acronyms within each chunk
                // E.g. "XMLParser" -> ["XML", "Parser"]
                // E.g. "CustomerId" -> ["Customer", "Id"]
                // E.g. "getHTTPResponseCode" -> ["get", "HTTP", "Response", "Code"]
                // E.g. "col1Name" -> ["col1", "Name"]
                let parts;
                try {
                    parts = chunk
                        .replace(/([\p{Lu}]+)([\p{Lu}][\p{Ll}])/gu, '$1 $2')
                        .replace(/([\p{Ll}\p{N}])([\p{Lu}])/gu, '$1 $2')
                        .split(/\s+/)
                        .filter(Boolean);
                } catch (_) {
                    parts = chunk
                        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
                        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
                        .split(/\s+/)
                        .filter(Boolean);
                }

                for (const p of parts) {
                    subWords.push({
                        raw: p,
                        lower: p.toLowerCase()
                    });
                }
            }

            return subWords;
        }

        splitSubWords(candidateName) {
            return CandidateFilter.splitSubWords(candidateName);
        }

        matchExact(candidateName, query) {
            return candidateName.toLowerCase() === query.toLowerCase();
        }

        matchPrefix(candidateName, query) {
            return candidateName.toLowerCase().startsWith(query.toLowerCase());
        }

        matchSubWord(candidateName, query) {
            if (!candidateName || !query) return null;
            const rawQuery = String(query).trim();
            if (rawQuery.length < 2) return null; // Single-char queries are prefix matches
            const queryLower = rawQuery.toLowerCase();

            // Clean candidate name (strip quotes, @, #)
            let cleanCandidate = candidateName.trim();
            if ((cleanCandidate.startsWith('[') && cleanCandidate.endsWith(']')) ||
                (cleanCandidate.startsWith('"') && cleanCandidate.endsWith('"')) ||
                (cleanCandidate.startsWith('`') && cleanCandidate.endsWith('`'))) {
                cleanCandidate = cleanCandidate.substring(1, cleanCandidate.length - 1);
            }
            cleanCandidate = cleanCandidate.replace(/^[#@]+/, '');
            const candidateLower = cleanCandidate.toLowerCase();

            // If query is already a full prefix of the entire candidate, let matchPrefix handle it
            if (candidateLower.startsWith(queryLower)) {
                return null;
            }

            const subWords = CandidateFilter.splitSubWords(cleanCandidate);
            if (!subWords || subWords.length < 2) return null;

            // Recursive search: partition query across sub-word prefixes
            function search(wordIdx, qIdx, matchedWordsCount, caseMatchesCount, skippedWordsCount) {
                if (qIdx === queryLower.length) {
                    return {
                        matchedWordsCount,
                        caseMatchesCount,
                        skippedWordsCount
                    };
                }

                if (wordIdx >= subWords.length) {
                    return null;
                }

                const currentWord = subWords[wordIdx];
                const firstCharQ = queryLower[qIdx];
                let best = null;

                // Option 1: Match prefix of currentWord starting with query[qIdx]
                if (currentWord.lower[0] === firstCharQ) {
                    const maxL = Math.min(currentWord.lower.length, queryLower.length - qIdx);
                    for (let L = maxL; L >= 1; L--) {
                        const qSlice = queryLower.substring(qIdx, qIdx + L);
                        if (currentWord.lower.startsWith(qSlice)) {
                            let caseBonus = 0;
                            if (rawQuery[qIdx] === currentWord.raw[0]) {
                                caseBonus++;
                            }
                            const res = search(wordIdx + 1, qIdx + L, matchedWordsCount + 1, caseMatchesCount + caseBonus, skippedWordsCount);
                            if (res) {
                                if (!best || res.skippedWordsCount < best.skippedWordsCount || res.caseMatchesCount > best.caseMatchesCount) {
                                    best = res;
                                }
                                if (best && best.skippedWordsCount === 0 && best.caseMatchesCount > 0) {
                                    return best;
                                }
                            }
                        }
                    }
                }

                // Option 2: Skip currentWord
                const remainingWords = subWords.length - (wordIdx + 1);
                const remainingChars = queryLower.length - qIdx;
                if (remainingWords >= remainingChars || (remainingWords > 0 && matchedWordsCount > 0)) {
                    const resSkip = search(wordIdx + 1, qIdx, matchedWordsCount, caseMatchesCount, skippedWordsCount + (matchedWordsCount > 0 ? 1 : 0));
                    if (resSkip) {
                        if (!best || resSkip.skippedWordsCount < best.skippedWordsCount || resSkip.caseMatchesCount > best.caseMatchesCount) {
                            best = resSkip;
                        }
                    }
                }

                return best;
            }

            const matchResult = search(0, 0, 0, 0, 0);
            if (!matchResult || matchResult.matchedWordsCount < 2) {
                return null;
            }

            // Calculate Sub-Word score strictly between 72 and 79
            // (Strictly higher than Substring 50-70, strictly lower than Prefix 80-95)
            let score = 75; // Baseline sub-word score

            // Consecutive words bonus
            if (matchResult.skippedWordsCount === 0) {
                score += 2;
            } else {
                score -= Math.min(3, matchResult.skippedWordsCount);
            }

            // Case-match bonus (e.g. cO or CO matching CustomerOrder)
            if (matchResult.caseMatchesCount > 0) {
                score += Math.min(2, matchResult.caseMatchesCount);
            }

            // Coverage ratio bonus
            const coverageRatio = queryLower.length / Math.max(queryLower.length, subWords.length);
            score += Math.round(coverageRatio * 1);

            return Math.max(72, Math.min(79, score));
        }

        matchSubstring(candidateName, query) {
            return candidateName.toLowerCase().includes(query.toLowerCase());
        }

        matchFuzzy(candidateName, query) {
            if (!query) return 100;
            const target = candidateName.toLowerCase();
            const pattern = query.toLowerCase();

            let targetIdx = 0;
            let patternIdx = 0;
            let consecutiveMatches = 0;
            let totalGaps = 0;
            let matchedFirstChar = false;

            while (targetIdx < target.length && patternIdx < pattern.length) {
                if (target[targetIdx] === pattern[patternIdx]) {
                    if (patternIdx === 0 && targetIdx === 0) matchedFirstChar = true;
                    if (targetIdx > 0 && target[targetIdx - 1] === pattern[patternIdx - 1]) {
                        consecutiveMatches++;
                    }
                    patternIdx++;
                } else if (patternIdx > 0) {
                    totalGaps++;
                }
                targetIdx++;
            }

            if (patternIdx < pattern.length) return -1; // Not all pattern chars found

            let score = 40;
            if (matchedFirstChar) score += 20;
            score += Math.min(20, consecutiveMatches * 5);
            score -= Math.min(25, totalGaps * 2);
            // Spec GĐ4 / RC10: Fuzzy score capped at 70 (< subword 72)
            return Math.min(70, Math.max(10, score));
        }

        filter(candidates, query = '') {
            if (!candidates || !Array.isArray(candidates)) return [];
            const rawQuery = String(query || '').trim();
            const cleanQuery = rawQuery.toLowerCase();
            const isV2Ranking = (typeof localStorage !== 'undefined' && localStorage.getItem('intellisense.v2.ranking') === 'false') ? false : true;

            if (!cleanQuery) {
                return candidates.map(c => ({
                    ...c,
                    _matchType: 'all',
                    _matchScore: 50
                }));
            }

            const prefixMatches = [];
            const subwordMatches = [];
            const substringMatches = [];
            const fuzzyMatches = [];

            candidates.forEach(item => {
                const name = item.name || item.label || '';
                const nameLower = name.toLowerCase();

                // Also check with leading #, @ and delimiters [, ", ` stripped for friendly matching
                const stripDelims = (s) => (s || '').replace(/^[\["`#@]+|[\]"`]+$/g, '');
                const nameClean = stripDelims(nameLower);
                const queryClean = stripDelims(cleanQuery);

                // Phase 9: Star Expansion query matching (*, expand, star)
                if (item.type === 'star_expansion') {
                    if (cleanQuery === '*' || (cleanQuery.length >= 3 && ('expand'.startsWith(cleanQuery) || 'star'.startsWith(cleanQuery)))) {
                        prefixMatches.push({
                            ...item,
                            _matchType: cleanQuery === '*' ? 'exact' : 'prefix',
                            _matchScore: cleanQuery === '*' ? 100 : 88
                        });
                    }
                    return;
                }

                // 1. Exact match
                if (nameLower === cleanQuery || (queryClean && nameClean === queryClean)) {
                    prefixMatches.push({
                        ...item,
                        _matchType: 'exact',
                        _matchScore: 100
                    });
                    return;
                }

                // 2. Prefix match
                if (nameLower.startsWith(cleanQuery) || (queryClean && nameClean.startsWith(queryClean))) {
                    const ratio = queryClean ? (queryClean.length / nameClean.length) : (cleanQuery.length / nameLower.length);
                    // Spec GĐ4 / RC3: Bỏ thưởng tỷ lệ độ dài: 85 + min(3, 15 * ratio)
                    const prefixScore = isV2Ranking
                        ? (85 + Math.min(3, Math.round(15 * ratio)))
                        : (80 + Math.round(ratio * 15));
                    prefixMatches.push({
                        ...item,
                        _matchType: 'prefix',
                        _matchScore: prefixScore
                    });
                    return;
                }

                // 2b. Phase 8: Sub-Word Match (PascalCase / camelCase / snake_case)
                // e.g. 'cid' -> 'CustomerId', 'odi' -> 'order_detail_id', 'co' -> 'CustomerOrder'
                const subwordScore = this.matchSubWord(name, rawQuery);
                if (subwordScore !== null && subwordScore > 0) {
                    subwordMatches.push({
                        ...item,
                        _matchType: 'subword',
                        _matchScore: subwordScore
                    });
                    return;
                }

                // 3. Substring match
                const subIdx = nameLower.indexOf(cleanQuery);
                if (subIdx !== -1) {
                    substringMatches.push({
                        ...item,
                        _matchType: 'substring',
                        _matchScore: Math.max(50, 70 - subIdx * 2)
                    });
                    return;
                }

                // 4. Fuzzy match (only if query length >= fuzzyThreshold)
                if (cleanQuery.length >= this.fuzzyThreshold) {
                    const fuzzyScore = this.matchFuzzy(name, cleanQuery);
                    if (fuzzyScore > 0) {
                        fuzzyMatches.push({
                            ...item,
                            _matchType: 'fuzzy',
                            _matchScore: fuzzyScore
                        });
                    }
                }
            });

            if (prefixMatches.length >= this.maxPrefixToSkipFuzzy) {
                return prefixMatches;
            }

            return [...prefixMatches, ...subwordMatches, ...substringMatches, ...fuzzyMatches];
        }
    }

    /**
     * CompletionRanker - Contextual Ranking Engine (Section 30)
     * Weighs context, clause, scope, qualifier, and match quality
     */

    window.CandidateFilter = CandidateFilter;
})(typeof window !== 'undefined' ? window : globalThis);
