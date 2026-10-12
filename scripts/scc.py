import json,sys
g=json.load(open(sys.argv[1]))
sys.setrecursionlimit(100000)
idx={};low={};st=[];on=set();out=[];i=[0]
def sc(v):
    idx[v]=low[v]=i[0];i[0]+=1;st.append(v);on.add(v)
    for w in g.get(v,[]):
        if w not in idx: sc(w);low[v]=min(low[v],low[w])
        elif w in on: low[v]=min(low[v],idx[w])
    if low[v]==idx[v]:
        c=[]
        while True:
            w=st.pop();on.discard(w);c.append(w)
            if w==v:break
        if len(c)>1: out.append(c)
for v in list(g):
    if v not in idx: sc(v)
out.sort(key=len,reverse=True)
for c in out: print(len(c), sorted(c) if len(c)<60 else '')
