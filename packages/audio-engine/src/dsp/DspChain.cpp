#include "DspChain.h"
#include "PEQ.h"
#include "Crossfeed.h"
#include "Dither.h"
#include "Resampler.h"

void DspChain::apply(const AceDspState& /*state*/)
{
    // TODO: configure each sub-processor from state
}

void DspChain::process(float* /*buf*/, int /*frames*/, int /*channels*/)
{
    // TODO: run PEQ → crossfeed → resampler → dither in order
}
