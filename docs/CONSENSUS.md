# Consensus

The leader fetches exactly two committed HTTPS images, verifies both hashes, and submits them to a bounded vision prompt. The validator independently fetches and verifies both images and independently reasons over the pair. Verdict, damage flag, and confidence band must agree; prose and region labels may differ. Hash failure becomes `UNAVAILABLE`; low/unclear item confidence cannot become `MATERIAL_DAMAGE`.
