#include <cuda_runtime.h>
#include <cstdio>
#define CHECK(x) do { cudaError_t e=(x); if(e!=cudaSuccess){fprintf(stderr,"%s\n",cudaGetErrorString(e));return 1;} } while(0)
__global__ void add(float *a) { int i=threadIdx.x; a[i]=float(i)+1.0f; }
int main() {
    cudaDeviceProp p; CHECK(cudaGetDeviceProperties(&p,0));
    printf("GPU=%s capability=%d.%d\n",p.name,p.major,p.minor);
    if(p.major!=12 || p.minor!=1) {fprintf(stderr,"Expected capability 12.1; stop.\n");return 2;}
    float *d, h[32]; CHECK(cudaMalloc(&d,sizeof(h)));
    add<<<1,32>>>(d); CHECK(cudaGetLastError()); CHECK(cudaDeviceSynchronize());
    CHECK(cudaMemcpy(h,d,sizeof(h),cudaMemcpyDeviceToHost)); CHECK(cudaFree(d));
    for(int i=0;i<32;i++) if(h[i]!=float(i)+1.0f) return 3;
    puts("SM121 CUDA smoke PASS; model kernels still require benchmark validation.");
}
